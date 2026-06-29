/**
 * Storage backend contract for Vellum's dashboard-mode uploads.
 *
 * The dashboard needs somewhere to keep uploaded PDFs so you can list, view,
 * and delete them. Two interchangeable backends implement this:
 *   - `memory`  — in-process Map (demo / local; ephemeral)
 *   - `r2`      — Cloudflare R2 (S3-compatible) for real persistence
 *
 * Bundled sample documents are NOT a backend concern — they're served from
 * /public and stitched in at the store layer. Backends only deal with uploads.
 */

/** Metadata for one uploaded document (never carries the bytes). */
export interface UploadMeta {
  id: string;
  name: string;
  sizeBytes: number;
  uploadedAt: number;
}

export interface StorageBackend {
  /** All uploads, newest first (metadata only). */
  list(): Promise<UploadMeta[]>;
  /** Metadata for one upload, or undefined if it doesn't exist. */
  head(id: string): Promise<UploadMeta | undefined>;
  /** The raw bytes of one upload, or undefined if it doesn't exist. */
  getBytes(id: string): Promise<Uint8Array | undefined>;
  /** Store a new upload; returns its metadata. */
  put(name: string, bytes: Uint8Array): Promise<UploadMeta>;
  /** Delete an upload; returns whether it existed. */
  remove(id: string): Promise<boolean>;
}

/** Cap so a long-lived deployment can't grow unbounded. */
export const MAX_UPLOADS = 25;

export function newUploadId(): string {
  return `u_${Math.random().toString(36).slice(2, 10)}`;
}

export function cleanName(name: string): string {
  return name.slice(0, 120) || "document.pdf";
}
