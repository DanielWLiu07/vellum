/**
 * Capability tokens - the trust boundary of the viewer.
 *
 * A capability token is a signed, self-contained grant: "whoever holds this may
 * view THIS document, watermarked THIS way, until THIS time." The viewer service
 * holds no database and no storage credentials. It trusts a request only because
 * the token's signature proves the host app (which shares the secret) minted it.
 *
 * Format (compact, JWT-like but minimal and dependency-free):
 *
 *     v1.<base64url(payload)>.<base64url(hmac)>
 *
 * The HMAC (SHA-256) covers `v1.<base64url(payload)>`, so any tampering with the
 * payload invalidates the signature. Tokens are passed to the viewer in the URL
 * *fragment* (`/embed#t=...`), which browsers never send to the server, never log,
 * and never leak via the Referer header.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

export const TOKEN_VERSION = "v1";

/** What the holder is allowed to do once the document is open. */
export interface ViewerPerms {
  /** Show a working download button. Default false. */
  download: boolean;
  /** Show a working print button. Default false. */
  print: boolean;
  /** Allow text selection / copy of the rendered text layer. Default false. */
  copy: boolean;
}

export interface CapabilityClaims {
  /** Absolute URL the proxy fetches the document bytes from (e.g. a presigned R2 GET URL). */
  src: string;
  /** Watermark text stamped on every page (e.g. "Daniel Liu • daniel@hosa.org"). Empty = none. */
  wm: string;
  /** Permissions granted to the holder. */
  perms: ViewerPerms;
  /** Expiry, unix seconds. The proxy refuses the token after this instant. */
  exp: number;
  /** Issued-at, unix seconds. */
  iat: number;
  /** Token id - opaque, for the host app's own audit logging. */
  jti: string;
}

export const DEFAULT_PERMS: ViewerPerms = { download: false, print: false, copy: false };

function b64urlEncode(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(str: string): Buffer {
  const pad = str.length % 4 === 0 ? "" : "=".repeat(4 - (str.length % 4));
  return Buffer.from(str.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}

function sign(signingInput: string, secret: string): string {
  return b64urlEncode(createHmac("sha256", secret).update(signingInput).digest());
}

export interface MintOptions {
  src: string;
  watermark?: string;
  perms?: Partial<ViewerPerms>;
  /** Seconds until expiry. Clamped to [30, 3600]. Default 900 (15 min). */
  ttlSeconds?: number;
  jti?: string;
  /** Injectable clock (unix seconds) for tests. Defaults to Date.now(). */
  now?: number;
}

/**
 * Mint a signed capability token. Called by the HOST app (e.g. HOSA), not the
 * viewer - but lives here so host and viewer share one canonical implementation.
 */
export function mintToken(secret: string, opts: MintOptions): string {
  if (!secret || secret.length < 16) {
    throw new Error("VELLUM_TOKEN_SECRET must be at least 16 chars");
  }
  if (!opts.src || !/^https?:\/\//i.test(opts.src)) {
    throw new Error("mintToken: src must be an absolute http(s) URL");
  }
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  const ttl = Math.min(3600, Math.max(30, opts.ttlSeconds ?? 900));
  const claims: CapabilityClaims = {
    src: opts.src,
    wm: opts.watermark ?? "",
    perms: { ...DEFAULT_PERMS, ...opts.perms },
    exp: now + ttl,
    iat: now,
    jti: opts.jti ?? randomId(),
  };
  const payload = b64urlEncode(Buffer.from(JSON.stringify(claims), "utf8"));
  const signingInput = `${TOKEN_VERSION}.${payload}`;
  return `${signingInput}.${sign(signingInput, secret)}`;
}

export type VerifyResult =
  | { ok: true; claims: CapabilityClaims }
  | { ok: false; reason: "malformed" | "bad_version" | "bad_signature" | "expired" };

/**
 * Verify a capability token: structural shape, signature (constant-time), and
 * expiry. Returns a discriminated result - never throws on bad input.
 */
export function verifyToken(secret: string, token: string, now?: number): VerifyResult {
  if (!secret) return { ok: false, reason: "bad_signature" };
  if (typeof token !== "string") return { ok: false, reason: "malformed" };

  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false, reason: "malformed" };
  const [version, payload, sig] = parts;
  if (version !== TOKEN_VERSION) return { ok: false, reason: "bad_version" };

  const expected = sign(`${version}.${payload}`, secret);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  // Length check first - timingSafeEqual throws on length mismatch.
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: "bad_signature" };
  }

  let claims: CapabilityClaims;
  try {
    claims = JSON.parse(b64urlDecode(payload).toString("utf8"));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (
    !claims ||
    typeof claims.src !== "string" ||
    typeof claims.exp !== "number" ||
    typeof claims.perms !== "object"
  ) {
    return { ok: false, reason: "malformed" };
  }

  const nowSec = now ?? Math.floor(Date.now() / 1000);
  if (nowSec >= claims.exp) return { ok: false, reason: "expired" };

  return { ok: true, claims };
}

function randomId(): string {
  // Short, collision-resistant enough for an audit id; not security-critical.
  return b64urlEncode(createHmac("sha256", String(Date.now()) + Math.random()).digest()).slice(0, 16);
}
