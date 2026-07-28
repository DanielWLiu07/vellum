/**
 * Optional cover thumbnail per document, kept as a sidecar map (docId -> image
 * id in lib/images.ts) so the storage layer doesn't need to change. Demo-grade
 * in-memory, like the other stores.
 */

import { persistMap } from "./durable";

const g = globalThis as unknown as { __vitalsThumbs?: Map<string, string> };
const store: Map<string, string> = (g.__vitalsThumbs ??= new Map());
const { persist } = persistMap("thumbnails", store);

export function setThumbnail(docId: string, imageId: string): void {
  store.set(docId, imageId);
  persist();
}

export function getThumbnail(docId: string): string | undefined {
  return store.get(docId);
}

/** Drop a doc's thumbnail mapping (call when the doc is deleted). */
export function deleteThumbnail(docId: string): void {
  if (store.delete(docId)) persist();
}
