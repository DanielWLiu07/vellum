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
import { type Identity, verifyIdentityToken } from "./identity-token";
import { setRequestSession } from "./request-context";
import type { Viewer } from "./visibility";

export const SESSION_COOKIE = "vitals_session";

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
 */
export async function enterRequest(req: NextRequest): Promise<void> {
  resolveViewer(req);
  await ensureReady();
}
