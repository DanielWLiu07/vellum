/**
 * Per-member profiles. Each identity (a HOSA member's id, or the local demo
 * "you") has its OWN profile - name, avatar, bio, handle - keyed by owner and
 * persisted. A new member's profile is seeded from their signed session
 * (name/chapter/role). The identity KEY (owner) is stable; it owns every
 * resource that member creates.
 *
 * Note: for a signed-in member, getViewer() takes chapter/role from the SIGNED
 * session, not the editable profile - so editing "role" in the profile is
 * cosmetic and can't self-escalate. Only the local demo "you" (no session)
 * derives its viewer from the profile.
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
    role: (id?.role as Role) ?? "student",
    updatedAt: 0,
  };
}

function profileFor(owner: string): Profile {
  return store.get(owner) ?? seedFor(owner);
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
  if (patch.chapter !== undefined) next.chapter = patch.chapter.trim().slice(0, PROFILE_LIMITS.chapter);
  if (patch.role !== undefined && ROLE_VALUES.includes(patch.role as Role)) next.role = patch.role as Role;
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
