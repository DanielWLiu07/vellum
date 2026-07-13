import { NextRequest, NextResponse } from "next/server";
import { enterRequest } from "@/lib/auth";

import { listDocs } from "@/lib/store";
import { getThumbnail } from "@/lib/thumbnails";
import { getViewer } from "@/lib/profile";
import { filterScoped } from "@/lib/visibility";

export const dynamic = "force-dynamic";

// The dashboard's document list (metadata only, never the bytes). Scoped to what
// the viewer is allowed to see so private and other-chapter docs are not leaked.
// The viewer is a demo identity here; in production it comes from the session.
export async function GET(req: NextRequest) {
  await enterRequest(req);
  if (process.env.VELLUM_DEMO_MODE !== "1") {
    return NextResponse.json({ error: "dashboard_disabled" }, { status: 404 });
  }
  const all = await listDocs();
  const docs = filterScoped(all, getViewer(), "accessible").map((d) => ({
    id: d.id,
    name: d.name,
    sizeBytes: d.sizeBytes,
    uploadedAt: d.uploadedAt,
    bundled: d.bundled,
    visibility: d.visibility,
    chapter: d.chapter,
    owner: d.owner,
    people: d.people,
    thumbnailId: getThumbnail(d.id),
    contentType: d.contentType,
    event: d.event,
    noPreview: d.noPreview,
    official: d.official,
    folderId: d.folderId,
  }));
  return NextResponse.json({ docs }, { headers: { "Cache-Control": "no-store" } });
}
