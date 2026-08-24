import { NextRequest, NextResponse } from "next/server";
import { enterRequest } from "@/lib/auth";

import { markRead } from "@/lib/notifications";
import { getViewer } from "@/lib/profile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function gated() {
  return process.env.VELLUM_DEMO_MODE !== "1"
    ? NextResponse.json({ error: "dashboard_disabled" }, { status: 404 })
    : null;
}

/**
 * Mark one notification read.
 *
 * Ownership is checked in lib/notifications against the viewer's own id, so
 * passing somebody else's notification id is a 403 rather than a silent
 * success. `not_found` and `forbidden` stay distinct here because neither
 * leaks anything a member could use: notification ids are UUIDs, so probing
 * for one is not a realistic enumeration path, and telling the caller which
 * of the two happened makes a genuine bug debuggable.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await enterRequest(req);
  const off = gated();
  if (off) return off;

  const { id } = await params;
  const res = markRead(id, getViewer().owner);
  if (!res.ok) {
    return NextResponse.json({ error: res.error }, { status: res.error === "not_found" ? 404 : 403 });
  }
  return NextResponse.json({ notification: res.notification }, { headers: { "Cache-Control": "no-store" } });
}
