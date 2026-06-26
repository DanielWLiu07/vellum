import { NextRequest, NextResponse } from "next/server";

import { addUpload } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 25 * 1024 * 1024;

// Dashboard-mode upload. Gated behind VELLUM_DEMO_MODE so an embed-only
// deployment can turn the standalone dashboard off.
export async function POST(req: NextRequest) {
  if (process.env.VELLUM_DEMO_MODE !== "1") {
    return NextResponse.json({ error: "dashboard_disabled" }, { status: 404 });
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
  const isPdf = bytes.length >= 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
  if (file.type !== "application/pdf" || !isPdf) {
    return NextResponse.json({ error: "not_pdf" }, { status: 415 });
  }
  const meta = addUpload(file.name, bytes);
  return NextResponse.json({ id: meta.id, name: meta.name, sizeBytes: meta.sizeBytes });
}
