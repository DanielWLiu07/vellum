import { NextRequest, NextResponse } from "next/server";

import { recordAudit } from "@/lib/audit";
import { enterRequest } from "@/lib/auth";
import { ensureReady } from "@/lib/bootstrap";
import { moderationConfigured } from "@/lib/moderation";
import { listPending, listQueue, resolveEntry } from "@/lib/moderation-queue";
import { getViewer } from "@/lib/profile";
import { setShare } from "@/lib/resource-share";
import { banPublicSharing, liftPublicShareBan, listShareBans } from "@/lib/share-ban";
import { normalizeVisibility } from "@/lib/visibility";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The moderation review surface. ADMIN ONLY - it exposes other people's held
// content and the ban list.
//
// Deliberately NOT behind VELLUM_DEMO_MODE, unlike /api/audit. A review queue
// that 404s outside the demo is a review queue nobody can drain in the one
// deployment where it matters.

export async function GET(req: NextRequest) {
  await enterRequest(req);
  await ensureReady();
  if (!getViewer().admin) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const pending = listPending();
  return NextResponse.json(
    {
      configured: moderationConfigured(),
      pending,
      pendingCount: pending.length,
      history: listQueue().filter((e) => e.status !== "pending"),
      bans: listShareBans(),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

/**
 * Review actions:
 *   { action: "approve", id, note? }   release the hold, restore the visibility
 *                                      the creator originally asked for
 *   { action: "reject",  id, note? }   uphold the hold; the item stays private
 *   { action: "ban",     owner, reason? }
 *   { action: "unban",   owner }
 */
export async function POST(req: NextRequest) {
  await enterRequest(req);
  await ensureReady();
  const viewer = getViewer();
  if (!viewer.admin) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const action = typeof body?.action === "string" ? body.action : "";

  if (action === "approve" || action === "reject") {
    const id = typeof body?.id === "string" ? body.id : "";
    const note = typeof body?.note === "string" ? body.note : "";
    const entry = resolveEntry(id, action === "approve" ? "approved" : "rejected", viewer.owner, note);
    if (!entry) return NextResponse.json({ error: "not_found" }, { status: 404 });

    // Restore the requested scope only AFTER the entry stops being pending -
    // while it is pending, clampVisibility would force this straight back to
    // private and the approval would silently do nothing.
    if (action === "approve" && entry.status === "approved") {
      setShare(
        entry.resourceId,
        { visibility: normalizeVisibility(entry.requestedVisibility) },
        { visibility: "private", chapter: "" },
        entry.owner,
      );
    }
    recordAudit(
      `moderation.${action}`,
      entry.title,
      [entry.reason, ...entry.categories].filter(Boolean).join(", "),
      viewer.owner,
    );
    return NextResponse.json({ entry }, { headers: { "Cache-Control": "no-store" } });
  }

  if (action === "ban" || action === "unban") {
    const owner = typeof body?.owner === "string" ? body.owner.trim() : "";
    if (!owner) return NextResponse.json({ error: "owner_required" }, { status: 400 });
    if (owner === viewer.owner) {
      return NextResponse.json({ error: "cannot_ban_self" }, { status: 400 });
    }
    if (action === "ban") {
      const reason = typeof body?.reason === "string" ? body.reason : "";
      const ban = banPublicSharing(owner, viewer.owner, reason);
      recordAudit("moderation.ban", owner, reason, viewer.owner);
      return NextResponse.json({ ban }, { headers: { "Cache-Control": "no-store" } });
    }
    const lifted = liftPublicShareBan(owner);
    recordAudit("moderation.unban", owner, undefined, viewer.owner);
    return NextResponse.json({ lifted }, { headers: { "Cache-Control": "no-store" } });
  }

  return NextResponse.json({ error: "unknown_action" }, { status: 400 });
}
