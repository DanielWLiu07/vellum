/**
 * Document store for Vitals's standalone dashboard mode.
 *
 * Vitals's *embedded* mode is stateless by design - the host app owns the
 * documents. Its *dashboard* mode needs somewhere to put uploads so you can
 * manage + share them. This layer stitches together two sources:
 *   - bundled samples (served from /public, defined here)
 *   - uploads, held by the active storage backend (in-memory or R2 - see
 *     ./storage). Set the R2_* env vars to make uploads durable.
 */

import { getShare } from "./resource-share";
import { backend, type UploadMeta, type UploadScope } from "./storage";
import type { Visibility } from "./visibility";

export interface DocMeta {
  id: string;
  name: string;
  /** Public path for a bundled sample (served from /public). */
  publicPath?: string;
  sizeBytes: number;
  uploadedAt: number;
  bundled: boolean;
  /** MIME type - application/pdf or an image/* type. */
  contentType: string;
  visibility: Visibility;
  chapter: string;
  owner: string;
}

const BUNDLED: DocMeta[] = [
  {
    id: "sample",
    name: "Vitals - overview (sample)",
    publicPath: "/sample.pdf",
    sizeBytes: 2553,
    uploadedAt: 0,
    bundled: true,
    contentType: "application/pdf",
    visibility: "public",
    chapter: "",
    owner: "system",
  },
];
const bundledById = new Map(BUNDLED.map((b) => [b.id, b]));

function toDocMeta(u: UploadMeta): DocMeta {
  // Uploads start with whatever scope they were stored with (private by default);
  // a later "share" is recorded in the sidecar and overrides it here.
  const share = getShare(u.id);
  return {
    id: u.id,
    name: u.name,
    sizeBytes: u.sizeBytes,
    uploadedAt: u.uploadedAt,
    bundled: false,
    contentType: u.contentType,
    visibility: share?.visibility ?? u.visibility,
    chapter: share?.chapter ?? u.chapter,
    owner: u.owner,
  };
}

/** Bundled samples first, then uploads (newest-first from the backend). */
export async function listDocs(): Promise<DocMeta[]> {
  const uploads = (await backend().list()).map(toDocMeta);
  return [...BUNDLED, ...uploads];
}

/** Metadata for one doc (never the bytes - use getDocBytes for those). */
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

export async function addUpload(
  name: string,
  bytes: Uint8Array,
  contentType = "application/pdf",
  scope?: UploadScope,
): Promise<DocMeta> {
  return toDocMeta(await backend().put(name, bytes, contentType, scope));
}

export async function deleteDoc(id: string): Promise<boolean> {
  if (bundledById.has(id)) return false; // bundled samples are immutable
  return backend().remove(id);
}
