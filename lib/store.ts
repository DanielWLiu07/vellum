/**
 * Demo document store for Vellum's standalone dashboard mode.
 *
 * Vellum's *embedded* mode is stateless by design — the host app owns the
 * documents. Its *dashboard* mode needs somewhere to put uploads so you can
 * manage + share them, so this is a small in-process store: a couple of bundled
 * samples (served from /public) plus session uploads held in memory.
 *
 * In-memory is deliberately demo-grade — uploads live as long as the serverless
 * instance stays warm and aren't shared across regions. A production deployment
 * would swap this for object storage (R2/S3) + a metadata table; the dashboard,
 * routes, and viewer wouldn't change.
 */

export interface DocMeta {
  id: string;
  name: string;
  /** Bytes, for an uploaded doc. Bundled samples are served from /public. */
  bytes?: Uint8Array;
  /** Public path for a bundled sample (served from /public). */
  publicPath?: string;
  sizeBytes: number;
  uploadedAt: number;
  bundled: boolean;
}

// Persist the Map across hot reloads / route modules in dev via globalThis.
const g = globalThis as unknown as { __vellumDocs?: Map<string, DocMeta> };
const docs: Map<string, DocMeta> = (g.__vellumDocs ??= new Map());

// Seed the bundled samples once.
const BUNDLED: Array<{ id: string; name: string; publicPath: string; sizeBytes: number }> = [
  { id: "sample", name: "Vellum — overview (sample)", publicPath: "/sample.pdf", sizeBytes: 2553 },
];
for (const b of BUNDLED) {
  if (!docs.has(b.id)) {
    docs.set(b.id, { ...b, uploadedAt: 0, bundled: true });
  }
}

export function listDocs(): DocMeta[] {
  return [...docs.values()].sort((a, b) => Number(b.bundled) - Number(a.bundled) || b.uploadedAt - a.uploadedAt);
}

export function getDoc(id: string): DocMeta | undefined {
  return docs.get(id);
}

export function addUpload(name: string, bytes: Uint8Array): DocMeta {
  const id = `u_${Math.random().toString(36).slice(2, 10)}`;
  const meta: DocMeta = {
    id,
    name: name.slice(0, 120) || "document.pdf",
    bytes,
    sizeBytes: bytes.byteLength,
    uploadedAt: Date.now(),
    bundled: false,
  };
  docs.set(id, meta);
  // Cap the store so a long-lived instance can't grow unbounded.
  const uploads = [...docs.values()].filter((d) => !d.bundled).sort((a, b) => a.uploadedAt - b.uploadedAt);
  while (uploads.length > 25) {
    const oldest = uploads.shift();
    if (oldest) docs.delete(oldest.id);
  }
  return meta;
}

export function deleteDoc(id: string): boolean {
  const d = docs.get(id);
  if (!d || d.bundled) return false;
  return docs.delete(id);
}
