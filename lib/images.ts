/**
 * Image store for flashcard/quiz card images.
 *
 * Kept separate from the document store (lib/store.ts) on purpose: card images
 * are not "resources" and must not show up in the resource pool. Delegates to
 * the shared object-storage blob store (lib/storage) under an `images/` prefix,
 * so images are durable exactly when uploads are - S3/R2 in production, an
 * in-memory ring buffer locally.
 */

import { imageStore } from "./storage";
import type { StoredBlob } from "./storage/types";

export type StoredImage = StoredBlob;

export async function putImage(bytes: Uint8Array, contentType: string): Promise<string> {
  const id = `img_${crypto.randomUUID()}`;
  await imageStore().put(id, bytes, contentType);
  return id;
}

export async function getImage(id: string): Promise<StoredImage | undefined> {
  return imageStore().get(id);
}
