/**
 * Render a subsection's source as page images for the custom scroll viewer.
 *
 * The PDF comes from one of two places: a Google Slides/Docs file exported to
 * PDF (link-shared, no auth), or an uploaded PDF's stored bytes. Either way we
 * render each page to a PNG so the player can stack them in our own styled
 * container - a clean viewer, not the browser's gray PDF chrome.
 *
 * Everything is cached in-process: the source PDF, the page count, and each
 * rendered page. Rendering is lazy (the client only requests visible pages).
 */

import { exportPdfUrl, type GoogleKind } from "./modules";
import { pdfPageCount, renderPdfPageImage } from "./pdf-content";
import { getDocBytes } from "./store";

/** Renderable source kinds (info has no PDF). */
export type RenderKind = "slides" | "doc" | "pdf";

const CAP_PDFS = 40;
const CAP_PAGES = 600;

const g = globalThis as unknown as {
  __vitalsDeckPdf?: Map<string, Uint8Array>;
  __vitalsDeckCount?: Map<string, number>;
  __vitalsDeckPage?: Map<string, Uint8Array>;
};
const pdfCache: Map<string, Uint8Array> = (g.__vitalsDeckPdf ??= new Map());
const countCache: Map<string, number> = (g.__vitalsDeckCount ??= new Map());
const pageCache: Map<string, Uint8Array> = (g.__vitalsDeckPage ??= new Map());

function cap<T>(m: Map<string, T>, max: number) {
  while (m.size > max) {
    const k = m.keys().next().value;
    if (k === undefined) break;
    m.delete(k);
  }
}

async function fetchDeckPdf(kind: RenderKind, id: string): Promise<Uint8Array | null> {
  const cacheKey = `${kind}:${id}`;
  const hit = pdfCache.get(cacheKey);
  if (hit) return hit;
  let bytes: Uint8Array | null = null;
  if (kind === "pdf") {
    // Uploaded PDF: its stored bytes are already a PDF.
    const b = await getDocBytes(id).catch(() => undefined);
    bytes = b ? new Uint8Array(b) : null;
  } else {
    // Google Slides/Docs: export to PDF over the fixed docs.google.com URL.
    const res = await fetch(exportPdfUrl(id, kind as GoogleKind), { redirect: "follow" }).catch(() => null);
    if (res && res.ok && (res.headers.get("content-type") ?? "").includes("application/pdf")) {
      bytes = new Uint8Array(await res.arrayBuffer());
    }
  }
  if (!bytes) return null;
  pdfCache.set(cacheKey, bytes);
  cap(pdfCache, CAP_PDFS);
  return bytes;
}

/** Number of pages in a source (Google export or uploaded PDF), or null. */
export async function deckPageCount(kind: RenderKind, id: string): Promise<number | null> {
  const cacheKey = `${kind}:${id}`;
  const hit = countCache.get(cacheKey);
  if (hit !== undefined) return hit;
  const bytes = await fetchDeckPdf(kind, id);
  if (!bytes) return null;
  // Don't cache a TRANSIENT parse failure as 0 - that would pin the viewer to
  // its error state for the whole process. Only cache a real count.
  const n = await pdfPageCount(bytes).catch(() => -1);
  if (n < 0) return null;
  countCache.set(cacheKey, n);
  return n;
}

/**
 * Drop every cached artifact for one source id (all kinds). Called when an
 * uploaded document is deleted, so its already-rendered pages can't keep being
 * served from cache after the bytes are gone.
 */
export function evictDeckCache(id: string): void {
  for (const kind of ["slides", "doc", "pdf"] as const) {
    pdfCache.delete(`${kind}:${id}`);
    countCache.delete(`${kind}:${id}`);
    const prefix = `${kind}:${id}:`;
    for (const key of [...pageCache.keys()]) if (key.startsWith(prefix)) pageCache.delete(key);
  }
}

/** Render one page (1-indexed) of a source to PNG bytes, or null. */
export async function deckPageImage(kind: RenderKind, id: string, page: number): Promise<Uint8Array | null> {
  const key = `${kind}:${id}:${page}`;
  const hit = pageCache.get(key);
  if (hit) return hit;
  const bytes = await fetchDeckPdf(kind, id);
  if (!bytes) return null;
  const img = await renderPdfPageImage(bytes, page).catch(() => null);
  if (!img) return null;
  pageCache.set(key, img);
  cap(pageCache, CAP_PAGES);
  return img;
}

/** Test-only reset. */
export function __resetDeckCache(): void {
  pdfCache.clear();
  countCache.clear();
  pageCache.clear();
}
