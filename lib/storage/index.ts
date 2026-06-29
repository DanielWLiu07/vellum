/**
 * Backend selector. R2 when all R2_* env vars are present; otherwise the
 * in-memory demo backend. The dashboard, routes, and viewer don't care which.
 */

import { memoryBackend } from "./memory";
import { r2Backend } from "./r2";
import type { StorageBackend } from "./types";

export function r2Configured(): boolean {
  return Boolean(
    process.env.R2_ENDPOINT &&
      (process.env.R2_BUCKET || process.env.R2_BUCKET_NAME) &&
      process.env.R2_ACCESS_KEY_ID &&
      process.env.R2_SECRET_ACCESS_KEY,
  );
}

export function backend(): StorageBackend {
  return r2Configured() ? r2Backend : memoryBackend;
}

export type { StorageBackend, UploadMeta } from "./types";
