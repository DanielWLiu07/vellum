/**
 * Document store for Vellum's standalone dashboard mode.
 *
 * Vellum's *embedded* mode is stateless by design — the host app owns the
 * documents. Its *dashboard* mode needs somewhere to put uploads so you can
 * manage + share them. This layer stitches together two sources:
 *   - bundled samples (served from /public, defined here)
 *   - uploads, held by the active storage backend (in-memory or R2 — see
 *     ./storage). Set the R2_* env vars to make uploads durable.
 */

import { backend, type UploadMeta } from "./storage";

export interface DocMeta {
  id: string;
  name: string;
  /** Public path for a bundled sample (served from /public). */
  publicPath?: string;
  sizeBytes: number;
  uploadedAt: number;
  bundled: boolean;
}

const BUNDLED: DocMeta[] = [
  {
    id: "sample",
    name: "Vellum — overview (sample)",
    publicPath: "/sample.pdf",
    sizeBytes: 2553,
    uploadedAt: 0,
    bundled: true,
  },
];
const bundledById = new Map(BUNDLED.map((b) => [b.id, b]));

function toDocMeta(u: UploadMeta): DocMeta {
  return {
    id: u.id,
    name: u.name,
    sizeBytes: u.sizeBytes,
    uploadedAt: u.uploadedAt,
    bundled: false,
  };
}

/** Bundled samples first, then uploads (newest-first from the backend). */
export async function listDocs(): Promise<DocMeta[]> {
  const uploads = (await backend().list()).map(toDocMeta);
  return [...BUNDLED, ...uploads];
}

/** Metadata for one doc (never the bytes — use getDocBytes for those). */
export async function getDoc(id: string): Promise<DocMeta | undefined> {
  const b = bundledById.get(id);
  if (b) return b;
  const u = await backend().head(id);
  return u ? toDocMeta(u) : undefined;
}

/** Raw bytes for an uploaded doc. Bundled samples are served via publicPath. */
export async function getDocBytes(id: string): Promise<Uint8Array | undefined> {
  if (bundledById.has(id)) return undefined;
  return backend().getBytes(id);
}

export async function addUpload(name: string, bytes: Uint8Array): Promise<DocMeta> {
  return toDocMeta(await backend().put(name, bytes));
}

export async function deleteDoc(id: string): Promise<boolean> {
  if (bundledById.has(id)) return false; // bundled samples are immutable
  return backend().remove(id);
}
