/**
 * Per-user resource favorites ("saved" / likes). Kept as a sidecar keyed by
 * (owner, resourceId) - exactly like resource-share - so the storage layers
 * stay untouched. Each owner's set is their own saved list, and because
 * favoriteCount() aggregates across owners the same rows are the public
 * like-count on a resource. That second reading is why /api/favorites resolves
 * an id and checks canView before writing: an unvalidated write here is a
 * number other members are shown. In-memory (globalThis) with a snapshot, like
 * the other stores.
 */

import { isHydrated, registerHydrator } from "./durable";
import { loadSnapshot, saveSnapshot } from "./persist";

const g = globalThis as unknown as { __vitalsFavorites?: Map<string, Set<string>> };
// owner -> the set of resource ids they have saved.
const store: Map<string, Set<string>> = (g.__vitalsFavorites ??= new Map());

// Sets aren't JSON-serializable, so snapshot as owner -> id[].
registerHydrator(async () => {
  const snap = await loadSnapshot<Record<string, string[]>>("favorites");
  if (snap) for (const [owner, ids] of Object.entries(snap)) store.set(owner, new Set(ids));
});
function persist(): void {
  if (!isHydrated()) return;
  const out: Record<string, string[]> = {};
  for (const [owner, set] of store) out[owner] = [...set];
  saveSnapshot("favorites", out);
}

export function isFavorite(owner: string, resourceId: string): boolean {
  return store.get(owner)?.has(resourceId) ?? false;
}

/** Save or unsave a resource for one owner. Returns the resulting saved state. */
export function setFavorite(owner: string, resourceId: string, on: boolean): boolean {
  if (on) {
    const set = store.get(owner) ?? new Set<string>();
    set.add(resourceId);
    store.set(owner, set);
    persist();
    return true;
  }
  const set = store.get(owner);
  if (set) {
    set.delete(resourceId);
    if (set.size === 0) store.delete(owner); // don't keep empty owner buckets around
    persist();
  }
  return false;
}

/** The resource ids one owner has saved. */
export function listFavorites(owner: string): string[] {
  return [...(store.get(owner) ?? [])];
}

/** How many owners have saved a resource - the social like-count. */
export function favoriteCount(resourceId: string): number {
  let n = 0;
  for (const set of store.values()) if (set.has(resourceId)) n++;
  return n;
}

/** Like-count for every saved resource at once: { resourceId: count }. */
export function favoriteCounts(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const set of store.values()) {
    for (const id of set) out[id] = (out[id] ?? 0) + 1;
  }
  return out;
}

/** Drop every owner's favorite of a resource (call when it is deleted). */
export function deleteFavoritesFor(resourceId: string): void {
  let changed = false;
  for (const [owner, set] of store) {
    if (set.delete(resourceId)) {
      changed = true;
      if (set.size === 0) store.delete(owner);
    }
  }
  if (changed) persist();
}

/** Test-only: clear all favorites. */
export function __resetFavorites(): void {
  store.clear();
}
