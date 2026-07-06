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

export interface ShareState {
  visibility: Visibility;
  chapter: string;
  people: PersonShare[];
  /** Display-name override (documents only — uploads can't be renamed in place). */
  name?: string;
}

const g = globalThis as unknown as { __vitalsShare?: Map<string, ShareState> };
const store: Map<string, ShareState> = (g.__vitalsShare ??= new Map());

export function getShare(docId: string): ShareState | undefined {
  return store.get(docId);
}

/**
 * Merge a partial update into a resource's share state. Callers pass only the
 * fields they're changing; anything else (e.g. the people list when just the
 * scope changes) is preserved. `defaults` seeds visibility/chapter the first
 * time a resource gets share state, so a people-only update doesn't silently
 * reset a deck's scope to something it never had.
 */
export function setShare(
  docId: string,
  patch: Partial<ShareState>,
  defaults: { visibility: Visibility; chapter: string } = { visibility: "public", chapter: "" },
): ShareState {
  const prev = store.get(docId);
  const next: ShareState = {
    visibility: patch.visibility ?? prev?.visibility ?? defaults.visibility,
    chapter: (patch.chapter ?? prev?.chapter ?? defaults.chapter).slice(0, 80),
    people: patch.people !== undefined ? normalizePeople(patch.people) : prev?.people ?? [],
    ...(patch.name !== undefined
      ? { name: patch.name }
      : prev?.name !== undefined
        ? { name: prev.name }
        : {}),
  };
  store.set(docId, next);
  return next;
}

/** Drop a resource's share state (call when it's deleted, to avoid orphans). */
export function deleteShare(docId: string): void {
  store.delete(docId);
}
