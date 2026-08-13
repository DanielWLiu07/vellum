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

/**
 * The ban on one owner, reason included. KEPT, not dead — but be aware that
 * today the only callers are lib/share-ban.test.ts.
 *
 * Kept for two reasons rather than "we might want it". First, it is the store's
 * point read: answering "why is this one owner banned?" through listShareBans()
 * means building and sorting every ban to look at one, and the tests that
 * observe a re-ban refreshing its reason would get worse, not better.
 *
 * Second, there is a specific unfinished consumer. `reason` is documented above
 * as the justification shown to reviewers, and nothing shows it: a refused
 * share returns clampedReason "sharing_restricted" (see the doc/deck/quiz PATCH
 * routes) and the dialog renders "Public sharing isn't available on your
 * account" — the admin's recorded reason, sitting right here, unread. Whoever
 * closes that gap needs this function.
 */
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
