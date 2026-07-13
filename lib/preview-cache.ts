/**
 * Cache of rendered page-1 preview PNGs, keyed by document id, so each PDF is
 * rendered at most once. Bounded LRU (insertion-order eviction). Lives here (not
 * in the route) so the delete path can evict a document's preview alongside its
 * other sidecar state. Demo-grade in-memory (globalThis).
 */

const CAP = 200;

const g = globalThis as unknown as { __vellumPreview?: Map<string, Uint8Array> };
const cache: Map<string, Uint8Array> = (g.__vellumPreview ??= new Map());

export function getPreview(id: string): Uint8Array | undefined {
  return cache.get(id);
}

export function setPreview(id: string, bytes: Uint8Array): void {
  cache.set(id, bytes);
  while (cache.size > CAP) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

/** Evict a document's cached preview (call when it is deleted). */
export function deletePreview(id: string): void {
  cache.delete(id);
}

/** Test-only: clear the preview cache. */
export function __resetPreviewCache(): void {
  cache.clear();
}
