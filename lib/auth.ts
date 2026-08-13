/**
 * Session layer. Vitals authenticates a HOSA member from a signed identity
 * token (see lib/identity-token). The token is handed off at /api/auth/enter and
 * stored as an httpOnly session cookie; every request re-verifies it and
 * resolves the per-request viewer.
 *
 * No session (local standalone demo) falls back to the local demo profile, so
 * the dashboard still works without the main site.
 */

import type { NextRequest } from "next/server";

import { ensureReady } from "./bootstrap";
import {
  type Identity,
  mintIdentityToken,
  SESSION_COOKIE,
  verifyIdentityToken,
} from "./identity-token";
import { getRequestSession, setRequestSession } from "./request-context";
import { rememberUser } from "./users";
import type { Viewer } from "./visibility";

// Re-exported so existing callers keep their import site; the constant itself
// lives in identity-token so proxy.ts can reach it without the store imports.
export { SESSION_COOKIE };

/** How long a Vitals session lasts, independent of the handoff token's life. */
export const SESSION_TTL_SECONDS = 8 * 3600;

function secret(): string {
  return process.env.VITALS_AUTH_SECRET ?? "";
}

/** Whether HOSA-attached auth is configured (a shared secret is set). */
export function authConfigured(): boolean {
  return secret().length >= 16;
}

/** Verify a raw session/identity token into an Identity, or null. */
export function readIdentity(token: string | undefined | null): Identity | null {
  if (!token) return null;
  const r = verifyIdentityToken(secret(), token);
  return r.ok ? r.identity : null;
}

/**
 * Mint the session cookie value for an already-verified identity.
 *
 * The handoff token arrives in a URL query parameter, so a copy of it lands in
 * access logs, CDN logs, and browser history. Reusing that copy AS the session
 * meant one logged URL was a full-length session for that member. Minting a
 * separate token here decouples the two lifetimes: the handoff token only has
 * to survive the redirect, so HOSA can cut it to about a minute while the
 * session keeps its full eight hours.
 *
 * Note this does not by itself invalidate the URL token — it stays valid until
 * its own exp. Shortening the mint TTL on the HOSA side is what closes the
 * window; this change is what makes that safe to do.
 */
export function mintSessionToken(id: Identity): string {
  return mintIdentityToken(secret(), {
    sub: id.sub,
    name: id.name,
    chapter: id.chapter,
    chapterName: id.chapterName,
    role: id.role,
    ttlSeconds: SESSION_TTL_SECONDS,
  });
}

export function viewerFromIdentity(id: Identity): Viewer {
  return { owner: id.sub, chapter: id.chapter, admin: id.role === "admin" };
}

/**
 * Resolve the session from the request cookie and stash the viewer for this
 * request. IMPORTANT: this reads req.cookies SYNCHRONOUSLY and calls enterWith
 * before any await, so the AsyncLocalStorage store reliably propagates through
 * the whole handler (an enterWith placed after an await doesn't propagate back
 * up to the caller in Next's runtime).
 */
export function resolveViewer(req: NextRequest): void {
  const id = readIdentity(req.cookies.get(SESSION_COOKIE)?.value);
  if (id) setRequestSession({ identity: id, viewer: viewerFromIdentity(id) });
}

/**
 * Per-request entry point for API routes: resolve the authenticated viewer,
 * then hydrate the durable stores. Call this first in every route that reads or
 * writes scoped data.
 *
 * Recording the member afterwards is how Vitals builds its roster (lib/users):
 * it has no user list of its own, so everyone it can assign work to is someone
 * it has seen arrive with a verified identity. The write is a no-op refresh
 * once nothing about the signed identity has changed.
 */
export async function enterRequest(req: NextRequest): Promise<void> {
  resolveViewer(req);
  await ensureReady(); // hydrate first: rememberUser writes to a durable store
  const session = getRequestSession();
  if (session) rememberUser(session.identity);
}
