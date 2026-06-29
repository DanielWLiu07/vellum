import { NextResponse } from "next/server";

import { listDocs } from "@/lib/store";

export const dynamic = "force-dynamic";

// The dashboard's document list (metadata only — never the bytes).
export async function GET() {
  if (process.env.VELLUM_DEMO_MODE !== "1") {
    return NextResponse.json({ error: "dashboard_disabled" }, { status: 404 });
  }
  const docs = (await listDocs()).map((d) => ({
    id: d.id,
    name: d.name,
    sizeBytes: d.sizeBytes,
    uploadedAt: d.uploadedAt,
    bundled: d.bundled,
  }));
  return NextResponse.json({ docs }, { headers: { "Cache-Control": "no-store" } });
}
