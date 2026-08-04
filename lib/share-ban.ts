/**
 * Per-user public-sharing ban.
 *
 * A ban does NOT suspend the account or touch existing private work: the user
 * keeps reading, uploading, and sharing with named people. What they lose is
 * the ability to put anything in front of an audience they haven't named —
 * `public`, and `chapter` (which is every member of their chapter).
 *
 * Enforcement lives in ONE place, resource-share.setShare, because that is the
 * only function that can raise a resource's visibility. Putting the check at
 * the eight call sites instead would mean the ninth one forgets.
 *
 * Demo-grade in-memory (globalThis) + snapshot, like the other stores.
 */

import { persistMap } from "./durable";

export interface ShareBan {
  /** Who imposed it (an admin's owner id), for the audit trail. */
  by: string;
  /** Free-text justification shown to reviewers. */
  reason: string;
  at: number;
}

const g = globalThis as unknown as { __vitalsShareBans?: Map<string, ShareBan> };
// owner -> the ban on them. Absent means unbanned; there is no "unbanned" row.
const store: Map<string, ShareBan> = (g.__vitalsShareBans ??= new Map());
const { persist } = persistMap("share-bans", store);

export function isPublicSharingBanned(owner: string): boolean {
  return store.has(owner);
}

export function getShareBan(owner: string): ShareBan | undefined {
  return store.get(owner);
}

/** Impose a ban. Re-banning an already-banned owner refreshes the reason. */
export function banPublicSharing(owner: string, by: string, reason = ""): ShareBan {
  const ban: ShareBan = { by, reason: reason.slice(0, 500), at: Date.now() };
  store.set(owner, ban);
  persist();
  return ban;
}

/** Lift a ban. Returns true when one was actually in place. */
export function liftPublicShareBan(owner: string): boolean {
  const had = store.delete(owner);
  if (had) persist();
  return had;
}

/** Every active ban, newest first — the admin list. */
export function listShareBans(): (ShareBan & { owner: string })[] {
  return [...store.entries()]
    .map(([owner, ban]) => ({ owner, ...ban }))
    .sort((a, b) => b.at - a.at);
}

/** Test-only: clear every ban. */
export function __resetShareBans(): void {
  store.clear();
}
