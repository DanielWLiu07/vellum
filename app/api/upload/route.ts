import { NextRequest, NextResponse } from "next/server";
import { enterRequest } from "@/lib/auth";

import { recordAudit } from "@/lib/audit";
import { scanCopyright } from "@/lib/copyright";
import {
  moderateImage,
  moderateText,
  moderationConfigured,
  type ModerationResult,
} from "@/lib/moderation";
import { disposition, strictest, type Disposition } from "@/lib/moderation-gate";
import { enqueue } from "@/lib/moderation-queue";
import { extractPdfText } from "@/lib/pdf-content";
import { moderatePdfContent } from "@/lib/pdf-moderation";
import { getViewer } from "@/lib/profile";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { setResourceMeta } from "@/lib/resource-meta";
import { canUpload } from "@/lib/settings";
import { addUpload } from "@/lib/store";
import { setThumbnail } from "@/lib/thumbnails";
import { viewerRole } from "@/lib/users";

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
  // "Allow student uploads" from the admin Settings pane. Only students are
  // ever restricted — locking out advisors would be a foot-gun, not a control.
  if (!canUpload(viewerRole())) {
    return NextResponse.json({ error: "uploads_disabled" }, { status: 403 });
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
  const imageMod = contentType.startsWith("image/") ? await moderateImage(bytes, contentType) : null;
  const pdfMod = contentType === "application/pdf" ? await moderatePdfContent(bytes) : null;
  const bodyMod: ModerationResult | null = imageMod ?? pdfMod;

  // Name the coverage gap, if there is one, so a reviewer sees WHY an item is
  // held rather than just that it is. Two cases the old binary check couldn't
  // express: an image past moderateImage's size cap (which returns an
  // allowed-but-unchecked result), and a PDF longer than the page-image cap,
  // where the text was read but most pages were never looked at.
  let coverageGap: string | undefined;
  if (imageMod && !imageMod.checked) {
    coverageGap = `image not examined (${(bytes.byteLength / (1024 * 1024)).toFixed(1)}MB)`;
  } else if (pdfMod && pdfMod.pagesChecked < pdfMod.totalPages) {
    coverageGap = `page images checked ${pdfMod.pagesChecked}/${pdfMod.totalPages}`;
  }

  // Kept apart rather than pushed straight into `checks`: which one refused is
  // the difference between "rename this" and "this picture can't be uploaded",
  // and the uploader can't act on the refusal without knowing.
  const nameDisp = disposition(nameMod);
  const bodyDisp = bodyMod ? disposition(bodyMod, coverageGap) : null;

  const checks: Disposition[] = [nameDisp];
  if (bodyDisp) checks.push(bodyDisp);
  // A partially-covered PDF reports checked:true (the text pass ran), so
  // disposition() alone would clear it. Add the gap as its own hold.
  if (coverageGap && bodyMod?.checked && moderationConfigured()) {
    checks.push({ action: "quarantine", reason: "unchecked", categories: [], detail: coverageGap });
  }
  const disp = strictest(checks);

  if (disp.action === "refuse") {
    recordAudit("document.blocked", name, disp.categories.join(", "));
    return NextResponse.json(
      {
        error: "content_flagged",
        categories: disp.categories,
        source: nameDisp.action === "refuse" ? "title" : "content",
      },
      { status: 422 },
    );
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

  // Held content is still stored and still the owner's to read - uploads start
  // private anyway. What the hold costs them is the ability to share it out,
  // which resource-share.clampVisibility enforces until a reviewer decides.
  if (disp.action === "quarantine") {
    enqueue({
      resourceId: meta.id,
      kind: "document",
      owner: viewer.owner,
      title: meta.name,
      reason: disp.reason,
      categories: disp.categories,
      detail: disp.detail,
      requestedVisibility: "private",
    });
    recordAudit(
      "document.quarantined",
      meta.name,
      [disp.reason, ...disp.categories, disp.detail].filter(Boolean).join(", "),
    );
  }

  return NextResponse.json({
    id: meta.id,
    name: meta.name,
    sizeBytes: meta.sizeBytes,
    contentType,
    // The hold has to travel with the reason. "Held for review" alone reads as
    // an accusation when the cause was a size cap nobody looked past, and the
    // owner needs to know sharing is what's blocked - the file is still theirs
    // to open.
    ...(disp.action === "quarantine"
      ? { heldForReview: true, holdReason: disp.reason, categories: disp.categories }
      : {}),
  });
}
