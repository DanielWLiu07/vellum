import { NextResponse } from "next/server";

import { listDocs } from "@/lib/store";
import { DEMO_VIEWER, filterScoped } from "@/lib/visibility";

export const dynamic = "force-dynamic";

// The dashboard's document list (metadata only, never the bytes). Scoped to what
// the viewer is allowed to see so private and other-chapter docs are not leaked.
// The viewer is a demo identity here; in production it comes from the session.
export async function GET() {
  if (process.env.VELLUM_DEMO_MODE !== "1") {
    return NextResponse.json({ error: "dashboard_disabled" }, { status: 404 });
  }
  const all = await listDocs();
  const docs = filterScoped(all, DEMO_VIEWER, "accessible").map((d) => ({
    id: d.id,
    name: d.name,
    sizeBytes: d.sizeBytes,
    uploadedAt: d.uploadedAt,
    bundled: d.bundled,
    visibility: d.visibility,
    chapter: d.chapter,
    owner: d.owner,
  }));
  return NextResponse.json({ docs }, { headers: { "Cache-Control": "no-store" } });
}
