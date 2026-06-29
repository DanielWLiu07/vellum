import { NextRequest, NextResponse } from "next/server";

import { clientIp, rateLimit } from "@/lib/rate-limit";
import { addUpload } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 25 * 1024 * 1024;

// Detect the file type from magic bytes (don't trust the client content-type).
// Vellum securely renders PDFs and images (canvas + watermark), so those are
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
  const meta = await addUpload(name, bytes, contentType);
  return NextResponse.json({ id: meta.id, name: meta.name, sizeBytes: meta.sizeBytes, contentType });
}
