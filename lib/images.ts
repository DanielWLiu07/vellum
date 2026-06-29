/**
 * Image store for flashcard cards.
 *
 * Kept separate from the document store (lib/store.ts) on purpose: card images
 * are not "resources" and must not show up in the resource pool. Demo-grade
 * in-memory ring buffer, like lib/decks.ts; a production build swaps in object
 * storage behind the same put/get.
 */

export interface StoredImage {
  bytes: Uint8Array;
  contentType: string;
}

const CAP = 400;

const g = globalThis as unknown as { __vellumImages?: Map<string, StoredImage> };
const store: Map<string, StoredImage> = (g.__vellumImages ??= new Map());

export function putImage(bytes: Uint8Array, contentType: string): string {
  const id = `img_${Math.random().toString(36).slice(2, 12)}`;
  store.set(id, { bytes, contentType });
  // Evict oldest beyond the cap (Map preserves insertion order).
  while (store.size > CAP) {
    const oldest = store.keys().next().value;
    if (oldest === undefined) break;
    store.delete(oldest);
  }
  return id;
}

export function getImage(id: string): StoredImage | undefined {
  return store.get(id);
}
