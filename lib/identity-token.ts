/**
 * Identity tokens - how Vitals authenticates a HOSA member.
 *
 * Vitals has no accounts of its own. The HOSA member platform (the "main site")
 * authenticates the member, then mints a signed identity token with a secret it
 * SHARES with Vitals. Vitals verifies the signature and trusts the identity -
 * exactly the capability-token model already used for the viewer (lib/token.ts),
 * but the payload is WHO the member is instead of WHAT they may view.
 *
 * Format (compact, dependency-free, same as lib/token.ts):
 *     vid1.<base64url(payload)>.<base64url(hmac-sha256)>
 *
 * The token is handed to Vitals at /api/auth/enter and stored as the session
 * cookie; every request re-verifies it. Both mint and verify live here so the
 * host app and Vitals share one canonical implementation.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

export const IDENTITY_VERSION = "vid1";

export type MemberRole = "student" | "trainer" | "advisor" | "admin";

export interface Identity {
  /** Stable user id from the host app - becomes the resource `owner`. */
  sub: string;
  /** Display name. */
  name: string;
  /**
   * Chapter IDENTITY - the host app's chapter id. This is the grouping and
   * scoping key: it's compared against stored values, so it must stay an id.
   * Never render it; it's a cuid. Use `chapterName` for display.
   */
  chapter: string;
  /**
   * Chapter DISPLAY name ("Toronto Central"). Optional: tokens minted before
   * this field existed don't carry it, and they must keep working for their
   * full 8h life - so every reader treats it as `chapterName || chapter` and
   * verification never requires it.
   */
  chapterName?: string;
  /** Role; "admin" grants admin in Vitals. */
  role: MemberRole;
  /** Expiry (unix seconds). */
  exp: number;
  /** Issued-at (unix seconds). */
  iat: number;
}

const ROLES: MemberRole[] = ["student", "trainer", "advisor", "admin"];

function b64urlEncode(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlDecode(str: string): Buffer {
  const pad = str.length % 4 === 0 ? "" : "=".repeat(4 - (str.length % 4));
  return Buffer.from(str.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}
function sign(input: string, secret: string): string {
  return b64urlEncode(createHmac("sha256", secret).update(input).digest());
}

export interface MintIdentityOptions {
  sub: string;
  name?: string;
  /** Chapter id (grouping key). */
  chapter?: string;
  /** Chapter display name. Omitted when unknown; readers fall back to `chapter`. */
  chapterName?: string;
  role?: MemberRole;
  /** Seconds until expiry. Clamped to [60, 86400]. Default 8h. */
  ttlSeconds?: number;
  /** Injectable clock (unix seconds) for tests. */
  now?: number;
}

/** Mint a signed identity token. Called by the HOST app (HOSA). */
export function mintIdentityToken(secret: string, opts: MintIdentityOptions): string {
  if (!secret || secret.length < 16) {
    throw new Error("identity secret must be at least 16 chars");
  }
  if (!opts.sub) throw new Error("mintIdentityToken: sub is required");
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  const ttl = Math.min(86_400, Math.max(60, opts.ttlSeconds ?? 8 * 3600));
  const identity: Identity = {
    sub: String(opts.sub).slice(0, 128),
    name: (opts.name ?? "").slice(0, 80),
    chapter: (opts.chapter ?? "").slice(0, 80),
    role: opts.role && ROLES.includes(opts.role) ? opts.role : "student",
    exp: now + ttl,
    iat: now,
  };
  // Only present when we actually have a name, so a token without a resolvable
  // chapter name is byte-identical to a pre-`chapterName` one.
  const chapterName = (opts.chapterName ?? "").slice(0, 80);
  if (chapterName) identity.chapterName = chapterName;
  const payload = b64urlEncode(Buffer.from(JSON.stringify(identity), "utf8"));
  const input = `${IDENTITY_VERSION}.${payload}`;
  return `${input}.${sign(input, secret)}`;
}

export type VerifyIdentityResult =
  | { ok: true; identity: Identity }
  | { ok: false; reason: "malformed" | "bad_version" | "bad_signature" | "expired" };

/** Verify an identity token: shape, signature (constant-time), expiry. */
export function verifyIdentityToken(secret: string, token: unknown, now?: number): VerifyIdentityResult {
  if (!secret) return { ok: false, reason: "bad_signature" };
  if (typeof token !== "string") return { ok: false, reason: "malformed" };
  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false, reason: "malformed" };
  const [version, payload, sig] = parts;
  if (version !== IDENTITY_VERSION) return { ok: false, reason: "bad_version" };

  const expected = sign(`${version}.${payload}`, secret);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: "bad_signature" };
  }

  let identity: Identity;
  try {
    identity = JSON.parse(b64urlDecode(payload).toString("utf8"));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (
    !identity ||
    typeof identity.sub !== "string" ||
    !identity.sub ||
    typeof identity.exp !== "number" ||
    !ROLES.includes(identity.role)
  ) {
    return { ok: false, reason: "malformed" };
  }
  // `chapterName` is deliberately NOT required: a token minted before the field
  // existed is still valid for its full life. Drop a non-string one so
  // consumers can trust the type without re-checking.
  if (typeof identity.chapterName !== "string" || !identity.chapterName) {
    delete identity.chapterName;
  }
  const nowSec = now ?? Math.floor(Date.now() / 1000);
  if (nowSec >= identity.exp) return { ok: false, reason: "expired" };
  return { ok: true, identity };
}
