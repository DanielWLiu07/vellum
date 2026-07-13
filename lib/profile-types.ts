/**
 * Client-safe profile types + constants. Kept separate from lib/profile (which
 * imports the server-only persistence layer) so client components can use the
 * Profile shape and the field limits without pulling node:fs into the bundle.
 */

import type { Role } from "./demo-data";

/** Stable identity key. Owns existing resources - do not change. */
export const OWNER_KEY = "you";

export interface Profile {
  /** Stable identity key used as the resource `owner`. */
  owner: string;
  displayName: string;
  /** Optional @handle (lowercase, [a-z0-9_]). */
  handle: string;
  bio: string;
  chapter: string;
  role: Role;
  /** Image id from /api/images, or undefined for the initials fallback. */
  avatarImageId?: string;
  updatedAt: number;
}

export const PROFILE_LIMITS = { name: 60, handle: 20, bio: 280, chapter: 80 } as const;

export interface ProfilePatch {
  displayName?: string;
  handle?: string;
  bio?: string;
  chapter?: string;
  role?: string;
  /** An image id, or null to clear the avatar back to initials. */
  avatarImageId?: string | null;
}
