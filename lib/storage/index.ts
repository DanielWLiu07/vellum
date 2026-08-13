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

export type StorageBackendName = "s3" | "r2" | "memory";

export function storageBackendName(): StorageBackendName {
  if (s3Configured()) return "s3";
  if (r2Configured()) return "r2";
  return "memory";
}

export interface StorageHealth {
  backend: StorageBackendName;
  /** False when uploads live only in this instance's memory. */
  durable: boolean;
}

/**
 * Whether an upload survives.
 *
 * The memory fallback is the right default for a keyless local run, but it is
 * indistinguishable from a working system until a file goes missing: uploads
 * last only as long as the instance stays warm and are invisible to every
 * other instance meanwhile. On a serverless host, where cold starts are
 * routine, that is ordinary data loss with no symptom.
 *
 * Everything else about durability was already observable — the snapshot
 * stores write to .data or the object KV — but blobs never had a signal at
 * all. This is it.
 */
export function storageHealth(): StorageHealth {
  const name = storageBackendName();
  return { backend: name, durable: name !== "memory" };
}

/**
 * Say it once per process, loudly, when a deployment is losing uploads.
 *
 * Not in development: a keyless local run is the documented default and the
 * warning would just be noise on every boot.
 */
let warned = false;
export function warnIfEphemeralStorage(): void {
  if (warned || process.env.NODE_ENV !== "production") return;
  warned = true;
  if (storageHealth().durable) return;
  console.error(
    "[storage] NO OBJECT STORE CONFIGURED - uploads are held in memory and " +
      "will be LOST on the next cold start, and are invisible to other " +
      "instances right now. Set R2_ENDPOINT / R2_BUCKET / R2_ACCESS_KEY_ID / " +
      "R2_SECRET_ACCESS_KEY (or the S3_* equivalents).",
  );
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
