/**
 * Per-resource share state, kept as a sidecar map (resource id -> state) so
 * the storage layers don't need an update path. Used by documents, decks, and
 * quizzes alike (their id namespaces — u_/d_/q_ + bundled names — never
 * collide). Holds everything Google-Docs-style sharing needs:
 *   - visibility + chapter (the "general access" scope)
 *   - people (direct per-person grants with viewer/editor roles)
 *   - name (rename override for documents, whose storage is immutable)
 * Demo-grade in-memory, like the other stores.
 */

import { normalizePeople, type PersonShare, type Visibility } from "./visibility";
import { isQuarantined } from "./moderation-queue";
import { getViewer } from "./profile";
import { isPublicSharingBanned } from "./share-ban";

export interface ShareState {
  visibility: Visibility;
  chapter: string;
  people: PersonShare[];
  /** Display-name override (documents only — uploads can't be renamed in place). */
  name?: string;
}

import { persistMap } from "./durable";

const g = globalThis as unknown as { __vitalsShare?: Map<string, ShareState> };
const store: Map<string, ShareState> = (g.__vitalsShare ??= new Map());
const { persist } = persistMap("resource-share", store);

export function getShare(docId: string): ShareState | undefined {
  return store.get(docId);
}

/**
 * The one gate between a resource and an audience. Two things force `private`
 * regardless of what a caller asked for:
 *
 *   - the resource is awaiting moderation review, so it must not reach anyone
 *     while the review it is waiting on is still open;
 *   - the actor is banned from public sharing.
 *
 * `chapter` is clamped too, not just `public` — a chapter is every member of
 * that chapter, which is exactly the audience a ban is meant to remove. Named
 * per-person grants are deliberately untouched: they survive both cases, so a
 * banned or held resource can still be handed to a specific reviewer.
 *
 * This lives here rather than at the setShare call sites because a check
 * repeated at nine of them is a check the tenth forgets.
 *
 * WHY THE ACTOR IS NOT A PLAIN ARGUMENT. It used to be an optional one, and
 * "centralized" then meant only that the `if` was written once: of the nine
 * call sites exactly one passed an actor, so `actor && …` was false everywhere
 * a member could reach and a ban was a row in the admin list that stopped
 * nothing. Making the argument REQUIRED would only move the failure — a
 * required parameter is satisfied by whatever is in scope, and a future call
 * site under deadline will pass the resource's owner, or "", and typecheck.
 * So the actor is resolved here from the request session instead. There is no
 * argument to forget, no call site that can opt out, and a new route gets the
 * check by doing nothing at all.
 *
 * The parameter survives only as an OVERRIDE, for the one caller whose subject
 * genuinely isn't the person making the request: moderation approval restores
 * the visibility a resource's OWNER asked for, so it weighs the ban on that
 * owner rather than on the admin pressing Approve.
 */
export function clampVisibility(
  docId: string,
  requested: Visibility,
  actor: string = getViewer().owner,
): Visibility {
  if (requested === "private") return requested;
  if (isQuarantined(docId)) return "private";
  if (actor && isPublicSharingBanned(actor)) return "private";
  return requested;
}

/**
 * Merge a partial update into a resource's share state. Callers pass only the
 * fields they're changing; anything else (e.g. the people list when just the
 * scope changes) is preserved. `defaults` seeds visibility/chapter the first
 * time a resource gets share state, so a people-only update doesn't silently
 * reset a deck's scope to something it never had — pass the resource's CURRENT
 * effective scope, never a literal, or the seed becomes a second copy of a
 * default that lives somewhere else.
 *
 * `actor` is the ban-check override described on clampVisibility; leaving it
 * out is the normal case and checks the authenticated caller.
 */
export function setShare(
  docId: string,
  patch: Partial<ShareState>,
  defaults: { visibility: Visibility; chapter: string } = { visibility: "public", chapter: "" },
  actor?: string,
): ShareState {
  const prev = store.get(docId);
  const requested = patch.visibility ?? prev?.visibility ?? defaults.visibility;
  const next: ShareState = {
    visibility: clampVisibility(docId, requested, actor),
    chapter: (patch.chapter ?? prev?.chapter ?? defaults.chapter).slice(0, 80),
    people: patch.people !== undefined ? normalizePeople(patch.people) : prev?.people ?? [],
    ...(patch.name !== undefined
      ? { name: patch.name }
      : prev?.name !== undefined
        ? { name: prev.name }
        : {}),
  };
  store.set(docId, next);
  persist();
  return next;
}

/** Drop a resource's share state (call when it's deleted, to avoid orphans). */
export function deleteShare(docId: string): void {
  if (store.delete(docId)) persist();
}
