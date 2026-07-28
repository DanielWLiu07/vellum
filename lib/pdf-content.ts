/**
 * Server-side PDF content extraction for moderation.
 *
 * Uses `unpdf` (a self-contained, serverless-friendly pdf.js wrapper) so it
 * does NOT collide with the client viewer's pinned pdfjs-dist. Two things come
 * out of a PDF: the text of every page, and a rendered PNG per page (so image
 * and drawn content on a page can be checked, not just its text).
 *
 * Rendering needs a canvas; @napi-rs/canvas is a prebuilt binary that works in
 * Node and on serverless. Both are declared in next.config's
 * serverExternalPackages so they aren't bundled.
 */

export interface PdfText {
  text: string;
  totalPages: number;
}

/** Extract the merged text of every page. Returns totalPages even if empty. */
export async function extractPdfText(bytes: Uint8Array): Promise<PdfText> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const doc = await getDocumentProxy(bytes.slice(0));
  const { text, totalPages } = await extractText(doc, { mergePages: true });
  return { text: String(text ?? ""), totalPages: totalPages ?? 0 };
}

/** Page count only (no text/render) - cheap way to size a viewer. */
export async function pdfPageCount(bytes: Uint8Array): Promise<number> {
  const { getDocumentProxy } = await import("unpdf");
  const doc = await getDocumentProxy(bytes.slice(0));
  return doc.numPages ?? 0;
}

/** Render one page (1-indexed) to PNG bytes. */
export async function renderPdfPageImage(bytes: Uint8Array, pageNumber: number): Promise<Uint8Array> {
  const { renderPageAsImage } = await import("unpdf");
  const buf = await renderPageAsImage(bytes.slice(0), pageNumber, {
    canvasImport: () => import("@napi-rs/canvas"),
  });
  return new Uint8Array(buf);
}
