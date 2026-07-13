import { NextRequest, NextResponse } from "next/server";
import { enterRequest } from "@/lib/auth";

import { recordAudit } from "@/lib/audit";
import { scanCopyright } from "@/lib/copyright";
import { flaggedReason, moderateImage, moderateText } from "@/lib/moderation";
import { extractPdfText } from "@/lib/pdf-content";
import { moderatePdfContent } from "@/lib/pdf-moderation";
import { getViewer } from "@/lib/profile";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { setResourceMeta } from "@/lib/resource-meta";
import { addUpload } from "@/lib/store";
import { setThumbnail } from "@/lib/thumbnails";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 25 * 1024 * 1024;

// Detect the file type from magic bytes (don't trust the client content-type).
// Vitals securely renders PDFs and images (canvas + watermark), so those are
// the accepted formats.
function sniffType(b: Uint8Array): string | null {
  if (b.length >= 4 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return "application/pdf";
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return "image/gif";
  if (
    b.length >= 12 &&
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
  ) return "image/webp";
  return null;
}

// Dashboard-mode upload. Gated behind VELLUM_DEMO_MODE so an embed-only
// deployment can turn the standalone dashboard off.
export async function POST(req: NextRequest) {
  await enterRequest(req);
  if (process.env.VELLUM_DEMO_MODE !== "1") {
    return NextResponse.json({ error: "dashboard_disabled" }, { status: 404 });
  }
  const rl = rateLimit(`upload:${clientIp(req)}`, 10, 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter), "Cache-Control": "no-store" } },
    );
  }
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "no_file" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "too_large" }, { status: 413 });
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const contentType = sniffType(bytes);
  if (!contentType) {
    return NextResponse.json({ error: "unsupported_type" }, { status: 415 });
  }
  // Optional display name override; falls back to the file name.
  const nameField = form?.get("name");
  const name = typeof nameField === "string" && nameField.trim() ? nameField.trim() : file.name;
  const eventField = form?.get("event");
  const event = typeof eventField === "string" ? eventField.trim().slice(0, 60) : "";
  const noPreview = form?.get("noPreview") === "1";
  // AI moderation. Always check the title text; then the BODY: an image upload
  // is checked as a picture, and a PDF is checked page by page (the text AND a
  // rendered image of every page, so nothing on any page slips through). No-ops
  // without a key.
  const nameMod = await moderateText([name, event].filter(Boolean).join("\n"));
  const bodyMod = contentType.startsWith("image/")
    ? await moderateImage(bytes, contentType)
    : contentType === "application/pdf"
      ? await moderatePdfContent(bytes)
      : null;
  const mod = !nameMod.allowed ? nameMod : bodyMod && !bodyMod.allowed ? bodyMod : null;
  if (mod) {
    recordAudit("document.blocked", name, flaggedReason(mod));
    return NextResponse.json({ error: "content_flagged", categories: mod.categories }, { status: 422 });
  }
  // Copyright screen: scan the title and (for PDFs) the document text for clear
  // markers of third-party published material, so we don't host an infringing
  // scan. Best-effort heuristic; the upload's rights-confirmation checkbox is
  // the other half of this defense.
  let copyrightText = name;
  if (contentType === "application/pdf") {
    try {
      const { text } = await extractPdfText(bytes);
      copyrightText += "\n" + text;
    } catch {
      // extraction failure: fall back to scanning the title only
    }
  }
  // Copyright markers (ISBN, publisher, notices) sit in the front matter, so a
  // bounded scan of the leading text is enough and avoids a huge allocation.
  const copyright = scanCopyright(copyrightText.slice(0, 200_000));
  if (copyright.flagged) {
    recordAudit("document.copyright_blocked", name, copyright.signals.join(", "));
    return NextResponse.json({ error: "copyright_flagged", signals: copyright.signals }, { status: 451 });
  }
  // Uploads start private; the owner shares them afterward from My resources.
  const viewer = getViewer();
  const scope = { visibility: "private" as const, chapter: viewer.chapter, owner: viewer.owner };
  const meta = await addUpload(name, bytes, contentType, scope);
  const thumbField = form?.get("thumbnailId");
  if (typeof thumbField === "string" && thumbField) setThumbnail(meta.id, thumbField.slice(0, 64));
  if (event || noPreview) setResourceMeta(meta.id, { event, noPreview });
  recordAudit("document.upload", meta.name);
  return NextResponse.json({ id: meta.id, name: meta.name, sizeBytes: meta.sizeBytes, contentType });
}
