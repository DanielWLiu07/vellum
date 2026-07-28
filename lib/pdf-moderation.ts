/**
 * Whole-PDF content moderation: run BOTH the text of every page AND a rendered
 * image of every page through the moderators, so nothing on any page slips
 * through - not a chart, a photo, or text baked into an image.
 *
 * Cost/latency: text is one (chunked) call covering all pages; page images are
 * one call each. Rendering + a call per page is the slow part, so image
 * moderation is capped (PDF_MODERATION_MAX_PAGES, default 20). TEXT still
 * covers every page regardless of the cap. For very large PDFs the right answer
 * is background processing; this synchronous pass is bounded by the cap.
 *
 * Fail-open: an extraction/render error on the whole document or a single page
 * is swallowed (that part is treated as allowed), matching lib/moderation.
 */

import { moderateImage, moderateText, moderationConfigured, type ModerationResult } from "./moderation";
import { extractPdfText, renderPdfPageImage } from "./pdf-content";

const DEFAULT_MAX_IMAGE_PAGES = 20;

export interface PdfModerationResult extends ModerationResult {
  /** Pages whose rendered image was actually moderated. */
  pagesChecked: number;
  /** Total pages in the document. */
  totalPages: number;
}

function maxImagePages(): number {
  const n = Number(process.env.PDF_MODERATION_MAX_PAGES);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_MAX_IMAGE_PAGES;
}

export async function moderatePdfContent(bytes: Uint8Array): Promise<PdfModerationResult> {
  if (!moderationConfigured()) {
    return { allowed: true, flagged: false, categories: [], checked: false, pagesChecked: 0, totalPages: 0 };
  }

  const categories = new Set<string>();
  let checked = false;
  let totalPages = 0;

  // 1. Text of every page (one combined, char-capped call).
  try {
    const { text, totalPages: tp } = await extractPdfText(bytes);
    totalPages = tp;
    if (text.trim()) {
      const tm = await moderateText(text);
      if (tm.checked) checked = true;
      for (const c of tm.categories) categories.add(c);
    }
  } catch {
    // fail open on extraction failure
  }

  // 2. A rendered image of each page, up to the cap.
  const pageMax = Math.min(totalPages, maxImagePages());
  let pagesChecked = 0;
  for (let page = 1; page <= pageMax; page++) {
    try {
      const png = await renderPdfPageImage(bytes, page);
      const im = await moderateImage(png, "image/png");
      if (im.checked) {
        checked = true;
        pagesChecked += 1;
      }
      for (const c of im.categories) categories.add(c);
    } catch {
      // fail open for a page that won't render
    }
  }

  const flagged = categories.size > 0;
  return {
    allowed: !flagged,
    flagged,
    categories: [...categories],
    checked,
    pagesChecked,
    totalPages,
  };
}
