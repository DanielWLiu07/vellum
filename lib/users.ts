/**
 * The people Vitals knows about - its roster.
 *
 * Vitals has no user table of its own. Members arrive from the HOSA member
 * platform carrying a signed identity token (lib/identity-token), and that
 * token is the only trustworthy statement of who someone is, which chapter
 * they belong to, and what role they hold. This module records each VERIFIED
 * identity the first time it's seen and refreshes it on later requests, so the
 * dashboard has real people to assign work to.
 *
 * LIMITATION (by design - the assign UI must say so): Vitals only knows members
 * who have ENTERED Vitals at least once. A student who has never followed the
 * handoff link from the member platform is invisible here and can't be assigned
 * anything. A production build would sync the roster from HOSA rather than
 * discovering it one sign-in at a time.
 *
 * Records are written ONLY from verified identities - never from a request body
 * and never from the editable profile (lib/profile), so a member can't edit
 * their way into another chapter's roster and pull assignments from it.
 *
 * Demo-grade durable store like the others; a production build swaps in a DB.
 */

import { persistMap } from "./durable";
import type { Identity, MemberRole } from "./identity-token";
import { getProfile } from "./profile";
import { getRequestSession } from "./request-context";

export type { MemberRole };

export interface KnownUser {
  /** The HOSA platform user id (the identity `sub`); also the resource owner. */
  id: string;
  /**
   * Chapter IDENTITY - the host app's chapter id, and the key everything here
   * groups and filters on. Never render it; it's a cuid.
   */
  chapter: string;
  /**
   * Chapter DISPLAY name. "" for a member whose token predates the field (or
   * whose chapter has no name), so readers use `chapterName || chapter`.
   * Display only - never filter or compare on this.
   */
  chapterName: string;
  name: string;
  role: MemberRole;
  firstSeenAt: number;
  lastSeenAt: number;
}

const NAME_MAX = 80;
const CHAPTER_MAX = 80;
const ID_MAX = 128;

const g = globalThis as unknown as { __vitalsUsers?: Map<string, KnownUser> };
const store: Map<string, KnownUser> = (g.__vitalsUsers ??= new Map());
const { persist } = persistMap("users", store);

const clamp = (s: string, n: number) => String(s ?? "").trim().slice(0, n);

/**
 * Record (or refresh) a member from their verified identity. Called on every
 * authenticated request, so the roster grows as members arrive and heals when
 * HOSA changes someone's chapter or role.
 *
 * `lastSeenAt` alone doesn't trigger a snapshot write - only a new member or a
 * changed signed field does. The updated timestamp still rides along with the
 * next write, which is plenty for a "who's active" hint.
 */
export function rememberUser(identity: Identity): KnownUser {
  const id = clamp(identity.sub, ID_MAX);
  if (!id) return { id: "", name: "", chapter: "", chapterName: "", role: "student", firstSeenAt: 0, lastSeenAt: 0 };
  const now = Date.now();
  const prev = store.get(id);
  const next: KnownUser = {
    id,
    name: clamp(identity.name, NAME_MAX) || prev?.name || id,
    chapter: clamp(identity.chapter, CHAPTER_MAX),
    chapterName: clamp(identity.chapterName ?? "", CHAPTER_MAX),
    role: identity.role,
    firstSeenAt: prev?.firstSeenAt ?? now,
    lastSeenAt: now,
  };
  const changed =
    !prev ||
    prev.name !== next.name ||
    prev.chapter !== next.chapter ||
    // A chapter RENAME moves only this field, so it has to count as a change or
    // the new name would sit in memory and never reach the snapshot.
    prev.chapterName !== next.chapterName ||
    prev.role !== next.role;
  store.set(id, next);
  if (changed) persist();
  return next;
}

export function getKnownUser(id: string): KnownUser | undefined {
  return store.get(clamp(id, ID_MAX));
}

/** Known members, optionally narrowed to one chapter and/or one role, by name.
 * `chapter` here is the chapter ID - never the display name. */
export function listKnownUsers(opts?: { chapter?: string; role?: MemberRole }): KnownUser[] {
  return [...store.values()]
    .filter((u) => (opts?.chapter === undefined || u.chapter === opts.chapter) && (opts?.role === undefined || u.role === opts.role))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The current viewer's role. `Viewer` (lib/visibility) only carries the coarse
 * `admin` bit, but assignment rules distinguish trainer and advisor from
 * student, so read the role from the SIGNED session. With no session (the local
 * standalone demo) it falls back to the local profile - which can't be patched
 * to a higher role, so this isn't an escalation path.
 */
export function viewerRole(): MemberRole {
  const session = getRequestSession();
  if (session) return session.identity.role;
  return getProfile().role;
}

/** Roles allowed to hand work out. Students may only see and complete theirs. */
export function canAssign(role: MemberRole): boolean {
  return role === "trainer" || role === "advisor" || role === "admin";
}

/** Test-only: forget every known member. */
export function __resetUsers(): void {
  store.clear();
}
