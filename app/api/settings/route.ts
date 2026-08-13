/**
 * Platform settings. ADMIN ONLY for writes; any signed-in member may read,
 * because the upload form needs to know whether it may offer an upload at all.
 *
 * Not gated on VELLUM_DEMO_MODE, for the same reason as /api/moderation: a
 * control that 404s outside the demo is a control nobody can use in the one
 * deployment where it matters.
 */

import { NextRequest, NextResponse } from "next/server";

import { recordAudit } from "@/lib/audit";
import { enterRequest } from "@/lib/auth";
import { ensureReady } from "@/lib/bootstrap";
import { getViewer } from "@/lib/profile";
import { getSettings, updateSettings } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  await enterRequest(req);
  await ensureReady();
  if (!getViewer().owner) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  return NextResponse.json(getSettings(), { headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(req: NextRequest) {
  await enterRequest(req);
  await ensureReady();
  const viewer = getViewer();
  if (!viewer.admin) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  const next = updateSettings(body);
  // A settings change is exactly the kind of thing someone needs to be able to
  // reconstruct afterwards ("who turned off student uploads, and when").
  recordAudit("settings.update", JSON.stringify(next), undefined, viewer.owner);
  return NextResponse.json(next, { headers: { "Cache-Control": "no-store" } });
}
