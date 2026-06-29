/**
 * In-memory storage backend - demo / local default.
 *
 * Uploads live as long as the serverless instance stays warm and aren't shared
 * across regions. Fine for the portfolio demo; set the R2_* env vars to switch
 * to durable object storage (see ./r2).
 */

import {
  MAX_UPLOADS,
  cleanName,
  newUploadId,
  type StorageBackend,
  type UploadMeta,
} from "./types";

interface Rec extends UploadMeta {
  bytes: Uint8Array;
}

// Persist across hot reloads / route modules in dev via globalThis.
const g = globalThis as unknown as { __vellumUploads?: Map<string, Rec> };
const store: Map<string, Rec> = (g.__vellumUploads ??= new Map());

function meta(r: Rec): UploadMeta {
  return { id: r.id, name: r.name, sizeBytes: r.sizeBytes, uploadedAt: r.uploadedAt, contentType: r.contentType };
}

export const memoryBackend: StorageBackend = {
  async list() {
    return [...store.values()].sort((a, b) => b.uploadedAt - a.uploadedAt).map(meta);
  },
  async head(id) {
    const r = store.get(id);
    return r ? meta(r) : undefined;
  },
  async getBytes(id) {
    return store.get(id)?.bytes;
  },
  async put(name, bytes, contentType = "application/pdf") {
    const rec: Rec = {
      id: newUploadId(),
      name: cleanName(name),
      sizeBytes: bytes.byteLength,
      uploadedAt: Date.now(),
      contentType,
      bytes,
    };
    store.set(rec.id, rec);
    // Evict the oldest beyond the cap.
    const oldestFirst = [...store.values()].sort((a, b) => a.uploadedAt - b.uploadedAt);
    while (oldestFirst.length > MAX_UPLOADS) {
      const old = oldestFirst.shift();
      if (old) store.delete(old.id);
    }
    return meta(rec);
  },
  async remove(id) {
    return store.delete(id);
  },
};
