import { readFile } from "node:fs/promises";
import path from "node:path";

import { NextRequest, NextResponse } from "next/server";
import { enterRequest } from "@/lib/auth";

import { renderPdfPageImage } from "@/lib/pdf-content";
import { getPreview, setPreview } from "@/lib/preview-cache";
import { getViewer } from "@/lib/profile";
import { getDoc, getDocBytes, type DocMeta } from "@/lib/store";
import { canView } from "@/lib/visibility";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Previews are viewer-scoped bytes rendered inside <img>; forbid sniffing and
// keep them out of shared caches (private, short-lived).
const PREVIEW_HEADERS = { "Cache-Control": "private, max-age=300", "X-Content-Type-Options": "nosniff" };

function notFound() {
  return NextResponse.json({ error: "not_found" }, { status: 404 });
}

// Upload bytes live in the backend; bundled samples are read from /public.
async function docBytes(doc: DocMeta): Promise<Uint8Array | undefined> {
  const b = await getDocBytes(doc.id);
  if (b) return b;
  if (doc.publicPath) {
    try {
      return new Uint8Array(await readFile(path.join(process.cwd(), "public", doc.publicPath.replace(/^\/+/, ""))));
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/**
 * Thumbnail preview of a document: the image itself for image uploads, or a
 * rendered first page for PDFs. Any failure returns 404 so the card falls back
 * to the placeholder. Scoped to what the viewer may see (no existence leak).
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await enterRequest(req);
  if (process.env.VELLUM_DEMO_MODE !== "1") return notFound();
  const { id } = await params;
  const doc = await getDoc(id);
  if (!doc) return notFound();
  if (!canView(doc, getViewer())) return notFound();
  if (doc.noPreview) return notFound(); // uploader opted out; client shows placeholder

  if (doc.contentType.startsWith("image/")) {
    const bytes = await docBytes(doc);
    if (!bytes) return notFound();
    return new NextResponse(Buffer.from(bytes), {
      headers: { ...PREVIEW_HEADERS, "Content-Type": doc.contentType },
    });
  }
  if (doc.contentType !== "application/pdf") return notFound();

  let png = getPreview(id);
  if (!png) {
    const bytes = await docBytes(doc);
    if (!bytes) return notFound();
    try {
      png = await renderPdfPageImage(bytes, 1);
    } catch {
      return notFound(); // corrupt / unrenderable PDF -> placeholder
    }
    setPreview(id, png);
  }
  return new NextResponse(Buffer.from(png), {
    headers: { ...PREVIEW_HEADERS, "Content-Type": "image/png" },
  });
}
