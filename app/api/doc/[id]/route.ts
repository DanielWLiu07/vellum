import { NextRequest, NextResponse } from "next/server";

import { recordAudit } from "@/lib/audit";
import { clientIp } from "@/lib/rate-limit";
import { deleteShare, setShare } from "@/lib/resource-share";
import { deleteDoc, getDoc, getDocBytes } from "@/lib/store";
import { deleteThumbnail } from "@/lib/thumbnails";
import { DEMO_VIEWER, canEdit, canManageSharing, canView, normalizePeople, normalizeVisibility } from "@/lib/visibility";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Serves a stored document's bytes. This is the `src` the viewer's proxy fetches
// (same-origin, so it passes the SSRF guard). Bundled samples redirect to their
// /public path; uploads stream from the in-memory store.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const doc = await getDoc(id);
  if (!doc) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!canView(doc, DEMO_VIEWER)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  if (doc.bundled && doc.publicPath) {
    return NextResponse.redirect(new URL(doc.publicPath, _req.nextUrl.origin));
  }
  const bytes = await getDocBytes(id);
  if (bytes) {
    return new NextResponse(bytes, {
      status: 200,
      headers: {
        "Content-Type": doc.contentType || "application/pdf",
        "Cache-Control": "no-store, max-age=0",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }
  return NextResponse.json({ error: "not_found" }, { status: 404 });
}

// Deletes an uploaded document (dashboard mode only). Bundled samples are
// immutable, so deleteDoc returns false for them and the caller gets a 404.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (process.env.VELLUM_DEMO_MODE !== "1") {
    return NextResponse.json({ error: "dashboard_disabled" }, { status: 404 });
  }
  const { id } = await params;
  const doc = await getDoc(id);
  if (!doc) return NextResponse.json({ error: "not_found" }, { status: 404 });
  // A doc the viewer can't even see reads as absent (no existence leak).
  if (!canView(doc, DEMO_VIEWER)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  // Bundled samples are immutable: there is nothing deletable at this id.
  if (doc.bundled) return NextResponse.json({ error: "not_found" }, { status: 404 });
  // Deleting is owner-only (editors can change a doc's sharing, not destroy it).
  if (doc.owner !== DEMO_VIEWER.owner && !DEMO_VIEWER.admin) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const ok = await deleteDoc(id);
  if (!ok) return NextResponse.json({ error: "not_found" }, { status: 404 });
  deleteShare(id); // drop sidecar entries so they don't accumulate as orphans
  deleteThumbnail(id);
  recordAudit("document.delete", doc.name, clientIp(_req));
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}

// Change a document's sharing (visibility/chapter/people) or rename it.
// Owner or a granted editor; bundled samples are immutable (copy them instead).
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (process.env.VELLUM_DEMO_MODE !== "1") {
    return NextResponse.json({ error: "dashboard_disabled" }, { status: 404 });
  }
  const { id } = await params;
  const doc = await getDoc(id);
  if (!doc) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (doc.bundled || !canEdit(doc, DEMO_VIEWER)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  // Any subset of fields; untouched share state is preserved. Rename is a
  // content change (editors allowed); visibility/chapter/people is sharing —
  // owner/admin only, so an editor can't publish or re-share the owner's doc.
  const patch: Parameters<typeof setShare>[1] = {};
  if (body.visibility !== undefined) patch.visibility = normalizeVisibility(body.visibility);
  if (typeof body.chapter === "string") patch.chapter = body.chapter.trim();
  if (body.people !== undefined) patch.people = normalizePeople(body.people, doc.owner);
  const wantsSharing =
    patch.visibility !== undefined || patch.chapter !== undefined || patch.people !== undefined;
  if (wantsSharing && !canManageSharing(doc, DEMO_VIEWER)) {
    return NextResponse.json({ error: "forbidden_sharing" }, { status: 403 });
  }
  if (typeof body.name === "string" && body.name.trim()) patch.name = body.name.trim().slice(0, 120);
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  // Seed defaults from the doc's current effective scope so a rename or a
  // people-only update doesn't reset an upload's visibility.
  const next = setShare(id, patch, { visibility: doc.visibility, chapter: doc.chapter });
  recordAudit("document.share", `${patch.name ?? doc.name} (${next.visibility})`, clientIp(req));
  return NextResponse.json(
    { ok: true, name: next.name ?? doc.name, visibility: next.visibility, chapter: next.chapter, people: next.people },
    { headers: { "Cache-Control": "no-store" } },
  );
}
