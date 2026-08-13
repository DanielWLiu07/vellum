import { NextRequest, NextResponse } from "next/server";
import { enterRequest } from "@/lib/auth";

import { recordAudit } from "@/lib/audit";
import { deleteShare, setShare } from "@/lib/resource-share";
import { deleteFavoritesFor } from "@/lib/favorites";
import { getFolder } from "@/lib/folders";
import { deleteQueueFor, describeOpenReview, enqueue, isQuarantined } from "@/lib/moderation-queue";
import { deletePreview } from "@/lib/preview-cache";
import { decidePublish } from "@/lib/publish";
import { evictDeckCache } from "@/lib/slides-render";
import { deleteResourceMeta, setResourceMeta } from "@/lib/resource-meta";
import { deleteDoc, getDoc, getDocBytes } from "@/lib/store";
import { deleteThumbnail } from "@/lib/thumbnails";
import { getViewer } from "@/lib/profile";
import { canEdit, canManageSharing, canView, normalizePeople, normalizeVisibility } from "@/lib/visibility";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Serves a stored document's bytes. This is the `src` the viewer's proxy fetches
// (same-origin, so it passes the SSRF guard). Bundled samples redirect to their
// /public path; uploads stream from the in-memory store.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await enterRequest(req);
  const { id } = await params;
  const doc = await getDoc(id);
  if (!doc) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!canView(doc, getViewer())) return NextResponse.json({ error: "not_found" }, { status: 404 }); // no existence leak

  if (doc.bundled && doc.publicPath) {
    return NextResponse.redirect(new URL(doc.publicPath, req.nextUrl.origin));
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
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await enterRequest(req);
  if (process.env.VELLUM_DEMO_MODE !== "1") {
    return NextResponse.json({ error: "dashboard_disabled" }, { status: 404 });
  }
  const { id } = await params;
  const doc = await getDoc(id);
  if (!doc) return NextResponse.json({ error: "not_found" }, { status: 404 });
  // A doc the viewer can't even see reads as absent (no existence leak).
  if (!canView(doc, getViewer())) return NextResponse.json({ error: "not_found" }, { status: 404 });
  // Bundled samples are immutable: there is nothing deletable at this id.
  if (doc.bundled) return NextResponse.json({ error: "not_found" }, { status: 404 });
  // Official HOSA resources are locked - only an admin can remove them.
  if (doc.official && !getViewer().admin) {
    return NextResponse.json({ error: "official_locked" }, { status: 403 });
  }
  // Deleting is owner-only (editors can change a doc's sharing, not destroy it).
  if (doc.owner !== getViewer().owner && !getViewer().admin) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const ok = await deleteDoc(id);
  if (!ok) return NextResponse.json({ error: "not_found" }, { status: 404 });
  deleteShare(id); // drop sidecar entries so they don't accumulate as orphans
  deleteFavoritesFor(id);
  deleteResourceMeta(id);
  deletePreview(id);
  deleteThumbnail(id);
  evictDeckCache(id); // drop any module-render cache so deleted bytes can't be re-served
  recordAudit("document.delete", doc.name);
  // Review entries are cleaned up like every other sidecar, but they are the
  // one kind worth a second line in the log: deleting your own work while a
  // reviewer is looking at it is allowed (see deleteQueueFor for why refusing
  // would be worse), and the record is the whole of what stops it being free.
  const openReview = deleteQueueFor(id);
  if (openReview.length > 0) {
    recordAudit("moderation.deleted_under_review", doc.name, describeOpenReview(openReview));
  }
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}

// Change a document's sharing (visibility/chapter/people) or rename it.
// Owner or a granted editor; bundled samples are immutable (copy them instead).
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await enterRequest(req);
  if (process.env.VELLUM_DEMO_MODE !== "1") {
    return NextResponse.json({ error: "dashboard_disabled" }, { status: 404 });
  }
  const { id } = await params;
  const doc = await getDoc(id);
  if (!doc) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (doc.bundled || !canEdit(doc, getViewer())) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  // Official HOSA resources are locked - only an admin may edit or re-share them.
  if (doc.official && !getViewer().admin) {
    return NextResponse.json({ error: "official_locked" }, { status: 403 });
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
  if (wantsSharing && !canManageSharing(doc, getViewer())) {
    return NextResponse.json({ error: "forbidden_sharing" }, { status: 403 });
  }
  if (typeof body.name === "string" && body.name.trim()) patch.name = body.name.trim().slice(0, 120);

  // Filing (folderId) and the official flag are resource-meta, not share state.
  // folderId: a string files the doc; null/"" unfiles it. official is admin-only.
  const metaPatch: Parameters<typeof setResourceMeta>[1] = {};
  if (body.folderId !== undefined) {
    // Filing is an organization change: owner/admin only (an editor can change
    // content but not where the OWNER's doc is filed).
    if (!canManageSharing(doc, getViewer())) {
      return NextResponse.json({ error: "forbidden_sharing" }, { status: 403 });
    }
    const target = body.folderId === null || body.folderId === "" ? "" : String(body.folderId);
    if (target) {
      // The target folder must be one the viewer may file into: their own
      // personal folder, or any folder if admin. This blocks filing a doc into
      // an OFFICIAL folder (admin-curated) or someone else's folder.
      const f = getFolder(target);
      const viewer = getViewer();
      const canFile = Boolean(f) && (viewer.admin || (!f!.official && f!.owner === viewer.owner));
      if (!canFile) return NextResponse.json({ error: "invalid_folder" }, { status: 403 });
    }
    metaPatch.folderId = target;
  }
  if (typeof body.official === "boolean") {
    if (!getViewer().admin) return NextResponse.json({ error: "admin_only" }, { status: 403 });
    metaPatch.official = body.official;
  }
  const wantsMeta = Object.keys(metaPatch).length > 0;

  if (Object.keys(patch).length === 0 && !wantsMeta) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  if (wantsMeta) setResourceMeta(id, metaPatch);

  // Going public is a submission, not a setting: it puts the file in front of
  // every member in the country. Private and chapter stay the member's own
  // call, and an admin publishes directly since they are the approver. See
  // lib/publish for why the line sits here.
  // Captured before decidePublish rewrites it, so a clamp can be compared
  // against what the caller actually asked for rather than what we settled on.
  const requestedVisibility = patch.visibility;
  let submitted = false;
  if (patch.visibility !== undefined) {
    const decision = decidePublish({
      requested: patch.visibility,
      current: doc.visibility,
      isAdmin: getViewer().admin,
    });
    if (decision.kind === "submit") {
      // Hold at what they already had, and record what they asked for so an
      // approval can restore it verbatim.
      patch.visibility = decision.hold;
      // `submitted` must track whether a request was actually FILED, not
      // whether one was attempted. It used to be set here, outside the guard
      // below, so a document that already had a pending hold answered
      // submittedForReview: true while enqueuing nothing and auditing nothing.
      // The member was told a reviewer had their publish request; it existed
      // nowhere. That path is easy to hit right now — every upload is being
      // held as "unchecked" while the moderation endpoint is down.
      if (!isQuarantined(id)) {
        enqueue({
          resourceId: id,
          kind: "document",
          owner: doc.owner,
          title: patch.name ?? doc.name,
          reason: "submitted",
          requestedVisibility: "public",
        });
        recordAudit("document.submitted", patch.name ?? doc.name);
        submitted = true;
      }
    }
  }

  // Seed defaults from the doc's current effective scope so a rename or a
  // people-only update doesn't reset an upload's visibility.
  const next = Object.keys(patch).length > 0
    ? setShare(id, patch, { visibility: doc.visibility, chapter: doc.chapter })
    : null;
  recordAudit("document.share", `${patch.name ?? doc.name}${next ? ` (${next.visibility})` : ""}`);
  return NextResponse.json(
    {
      ok: true,
      name: next?.name ?? patch.name ?? doc.name,
      visibility: next?.visibility ?? doc.visibility,
      chapter: next?.chapter ?? doc.chapter,
      people: next?.people ?? doc.people,
      // The caller asked for public and got held at something narrower — say
      // so, or the UI silently shows the old scope and looks like a failed save.
      ...(submitted ? { submittedForReview: true } : {}),
      // A scope that was refused outright. clampVisibility does this for a
      // held resource or a share-banned owner, and reporting {ok:true} without
      // saying so meant the owner clicked Share, saw success, and the file
      // never moved — with nothing anywhere to explain why.
      ...(!submitted &&
      requestedVisibility !== undefined &&
      next &&
      next.visibility !== requestedVisibility
        ? {
            clamped: true,
            clampedTo: next.visibility,
            clampedReason: isQuarantined(id) ? "held_for_review" : "sharing_restricted",
          }
        : {}),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
