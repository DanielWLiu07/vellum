/**
 * Per-member profiles. Each identity (a HOSA member's id, or the local demo
 * "you") has its OWN profile - name, avatar, bio, handle - keyed by owner and
 * persisted. A new member's profile is seeded from their signed session
 * (name/chapter/role). The identity KEY (owner) is stable; it owns every
 * resource that member creates.
 *
 * Chapter and role are HOSA's to set, not the member's: both come from the
 * SIGNED session, neither is patchable, and profileFor() overlays the current
 * signed values so what's stored can never outrank what HOSA says. That's what
 * keeps a member from typing their way into another chapter's assignments and
 * roster, or into a role that grants admin. Only the local demo "you" (no
 * session) derives its viewer from the profile.
 */

import type { Role } from "./demo-data";
import { isHydrated, registerHydrator } from "./durable";
import { loadSnapshot, saveSnapshot } from "./persist";
import { OWNER_KEY, PROFILE_LIMITS, type Profile, type ProfilePatch } from "./profile-types";
import { getRequestSession } from "./request-context";
import type { Viewer } from "./visibility";

export { OWNER_KEY, PROFILE_LIMITS, type Profile, type ProfilePatch };

const ROLE_VALUES: Role[] = ["student", "trainer", "advisor", "admin"];

const g = globalThis as unknown as { __vitalsProfiles?: Map<string, Profile> };
const store: Map<string, Profile> = (g.__vitalsProfiles ??= new Map());

// Hydrate the per-owner map; migrate the old single-profile snapshot if present.
registerHydrator(async () => {
  const map = await loadSnapshot<Record<string, Profile>>("profiles");
  if (map) {
    for (const [k, v] of Object.entries(map)) store.set(k, v);
  } else {
    const old = await loadSnapshot<Profile>("profile");
    if (old?.owner) store.set(old.owner, old);
  }
});

function persist(): void {
  if (isHydrated()) saveSnapshot("profiles", Object.fromEntries(store));
}

/** A default profile for an owner, seeded from the session when it's theirs. */
function seedFor(owner: string): Profile {
  const s = getRequestSession();
  const id = s && s.identity.sub === owner ? s.identity : null;
  return {
    owner,
    displayName: id?.name || "You",
    handle: "",
    bio: "",
    chapter: id?.chapter ?? (owner === OWNER_KEY ? "Toronto Central" : ""),
    // The local demo has no id/name split - its `chapter` is already a display
    // string, and `chapterName || chapter` lands on it.
    chapterName: id?.chapterName ?? "",
    role: (id?.role as Role) ?? "student",
    updatedAt: 0,
  };
}

function profileFor(owner: string): Profile {
  const stored = store.get(owner);
  if (!stored) return seedFor(owner);
  // A stored chapter/role is only a snapshot of what the member's token said
  // the last time they saved. Overlay the CURRENT signed values so a stale (or
  // historically self-typed) record can never be displayed as their chapter.
  // Saving then writes the overlaid values back, healing the record.
  const s = getRequestSession();
  const id = s && s.identity.sub === owner ? s.identity : null;
  // `?? ""` covers records snapshotted before chapterName existed.
  return id
    ? { ...stored, chapter: id.chapter, chapterName: id.chapterName ?? "", role: id.role }
    : { ...stored, chapterName: stored.chapterName ?? "" };
}

/** A copy of the current viewer's profile (callers must not mutate the store). */
export function getProfile(): Profile {
  return { ...profileFor(getViewer().owner) };
}

/** Handles are lowercase and limited to letters, digits, and underscores. */
function cleanHandle(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, PROFILE_LIMITS.handle);
}

/**
 * Apply a partial update to the current viewer's profile. Only the fields
 * present in `patch` change; each is trimmed and clamped. Unknown roles ignored.
 */
export function updateProfile(patch: ProfilePatch): Profile {
  const owner = getViewer().owner;
  const next: Profile = { ...profileFor(owner), owner };
  if (patch.displayName !== undefined) {
    next.displayName = patch.displayName.trim().slice(0, PROFILE_LIMITS.name) || "You";
  }
  if (patch.handle !== undefined) next.handle = cleanHandle(patch.handle);
  if (patch.bio !== undefined) next.bio = patch.bio.trim().slice(0, PROFILE_LIMITS.bio);
  // `chapter` is intentionally NOT patchable either. A member's chapter is set
  // on their HOSA account and carried in the signed session's `chapter` claim;
  // it decides which chapter's assignments and roster they belong to, so a
  // client-supplied chapter was a way to type yourself into another chapter and
  // receive its work. It comes from the session (seeded by seedFor, kept
  // current by the overlay in profileFor) and from nowhere else.
  // `role` is intentionally NOT patchable. getViewer() derives `admin` from
  // this profile when there is no session, so accepting a client-supplied role
  // was a self-escalation path for signed-out visitors. A member's role comes
  // from their signed session and is written only by seedFromSession below.
  void ROLE_VALUES;
  if (patch.avatarImageId !== undefined) {
    next.avatarImageId = patch.avatarImageId ? patch.avatarImageId.slice(0, 64) : undefined;
  }
  next.updatedAt = Date.now();
  store.set(owner, next);
  persist();
  return { ...next };
}

/**
 * The permission viewer - the source of truth for access checks. An
 * authenticated HOSA session IS the viewer (real id / chapter / role). With no
 * session (local standalone demo), it falls back to the local demo profile.
 */
export function getViewer(): Viewer {
  const session = getRequestSession();
  if (session) return session.viewer;
  const p = profileFor(OWNER_KEY);
  return { owner: p.owner, chapter: p.chapter, admin: p.role === "admin" };
}

/** Test-only: clear all profiles. */
export function __resetProfile(): void {
  store.clear();
}
