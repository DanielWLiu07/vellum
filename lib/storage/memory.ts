/**
 * In-memory storage backend - demo / local default.
 *
 * Uploads live as long as the serverless instance stays warm and aren't shared
 * across regions. Fine for the portfolio demo; set the R2_* env vars to switch
 * to durable object storage (see ./r2).
 */

import {
  DEFAULT_SCOPE,
  MAX_UPLOADS,
  cleanName,
  newUploadId,
  type BlobStore,
  type StoredBlob,
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
  return {
    id: r.id,
    name: r.name,
    sizeBytes: r.sizeBytes,
    uploadedAt: r.uploadedAt,
    contentType: r.contentType,
    visibility: r.visibility,
    chapter: r.chapter,
    owner: r.owner,
  };
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
  async put(name, bytes, contentType = "application/pdf", scope = DEFAULT_SCOPE) {
    const rec: Rec = {
      id: newUploadId(),
      name: cleanName(name),
      sizeBytes: bytes.byteLength,
      uploadedAt: Date.now(),
      contentType,
      visibility: scope.visibility,
      chapter: scope.chapter,
      owner: scope.owner,
      bytes,
    };
    store.set(rec.id, rec);
    // Cap the store, but only ever evict the NEW owner's own oldest uploads.
    // A global oldest-first eviction let anyone who can copy a resource (copy
    // is gated on canView, not ownership) push the store over cap and silently
    // delete another owner's documents — bypassing the owner-only delete gate
    // (security review finding). Scoping eviction to the caller makes the cap a
    // per-owner bound and keeps it destruction-safe.
    const mine = [...store.values()]
      .filter((r) => r.owner === rec.owner)
      .sort((a, b) => a.uploadedAt - b.uploadedAt);
    while (mine.length > MAX_UPLOADS) {
      const old = mine.shift();
      if (old) store.delete(old.id);
    }
    return meta(rec);
  },
  async remove(id) {
    return store.delete(id);
  },
};

/**
 * Insert a fully-specified record directly (demo seeding only - lets the seed
 * control id/owner/date, which put() would otherwise assign). No-op safety: the
 * caller decides when this runs.
 */
export function __seedUpload(rec: UploadMeta & { bytes: Uint8Array }): void {
  store.set(rec.id, { ...rec });
}

/**
 * In-memory BlobStore - the local/demo fallback for the durable object-storage
 * blob store. A capped ring buffer (Map preserves insertion order), so it can't
 * grow unbounded across a long-lived warm instance. Lost on restart, like the
 * upload memory backend; set S3/R2 env vars for durability.
 */
export function makeMemoryBlobStore(globalKey: string, cap: number): BlobStore {
  const gb = globalThis as unknown as Record<string, Map<string, StoredBlob> | undefined>;
  const blobs: Map<string, StoredBlob> = (gb[globalKey] ??= new Map());
  return {
    async get(id) {
      return blobs.get(id);
    },
    async put(id, bytes, contentType) {
      blobs.set(id, { bytes, contentType });
      while (blobs.size > cap) {
        const oldest = blobs.keys().next().value;
        if (oldest === undefined) break;
        blobs.delete(oldest);
      }
    },
    async remove(id) {
      return blobs.delete(id);
    },
  };
}
