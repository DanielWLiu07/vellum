/**
 * Optional cover thumbnail per document, kept as a sidecar map (docId -> image
 * id in lib/images.ts) so the storage layer doesn't need to change. Demo-grade
 * in-memory, like the other stores.
 */

const g = globalThis as unknown as { __vitalsThumbs?: Map<string, string> };
const store: Map<string, string> = (g.__vitalsThumbs ??= new Map());

export function setThumbnail(docId: string, imageId: string): void {
  store.set(docId, imageId);
}

export function getThumbnail(docId: string): string | undefined {
  return store.get(docId);
}
