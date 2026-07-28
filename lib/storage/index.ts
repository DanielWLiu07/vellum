/**
 * Backend selector. Native Amazon S3 when the S3_* env vars are present, else
 * Cloudflare R2 when the R2_* vars are present, else the in-memory demo
 * backend. The dashboard, routes, and viewer don't care which.
 */

import { makeMemoryBlobStore, memoryBackend } from "./memory";
import { r2Backend, r2ImageStore, r2Kv } from "./r2";
import { s3Backend, s3ImageStore, s3Kv, s3Configured } from "./s3";
import type { StateKv } from "./s3-backend";
import type { BlobStore, StorageBackend } from "./types";

export function r2Configured(): boolean {
  return Boolean(
    process.env.R2_ENDPOINT &&
      (process.env.R2_BUCKET || process.env.R2_BUCKET_NAME) &&
      process.env.R2_ACCESS_KEY_ID &&
      process.env.R2_SECRET_ACCESS_KEY,
  );
}

/** True when any durable object store (S3 or R2) is configured. */
export function objectStoreConfigured(): boolean {
  return s3Configured() || r2Configured();
}

export function backend(): StorageBackend {
  if (s3Configured()) return s3Backend;
  if (r2Configured()) return r2Backend;
  return memoryBackend;
}

/** Durable key-value store for app state, or null when no object store is set. */
export function objectKv(): StateKv | null {
  if (s3Configured()) return s3Kv;
  if (r2Configured()) return r2Kv;
  return null;
}

// One shared memory blob store instance for images when no object store is set,
// so every call resolves to the same underlying map. Cap mirrors the previous
// in-memory image ring buffer.
const memoryImageStore = makeMemoryBlobStore("__vellumImages", 400);

/** Durable byte store for card/flashcard images (durable iff S3/R2 is set). */
export function imageStore(): BlobStore {
  if (s3Configured()) return s3ImageStore;
  if (r2Configured()) return r2ImageStore;
  return memoryImageStore;
}

export { s3Configured };
export type { BlobStore, StorageBackend, UploadMeta, UploadScope } from "./types";
