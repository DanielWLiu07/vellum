import { NextRequest, NextResponse } from "next/server";
import { enterRequest } from "@/lib/auth";

import { listAudit, listModerationBlocks } from "@/lib/audit";
import { moderationConfigured } from "@/lib/moderation";
import { getViewer } from "@/lib/profile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Admin audit surface: the full cross-user action trail (with actor IPs, titles,
// moderation reasons) plus a moderation report. ADMIN ONLY - this is everyone's
// activity, so a non-admin must not see it.
export async function GET(req: NextRequest) {
  await enterRequest(req);
  if (process.env.VELLUM_DEMO_MODE !== "1") {
    return NextResponse.json({ error: "dashboard_disabled" }, { status: 404 });
  }
  if (!getViewer().admin) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const blocks = listModerationBlocks();
  return NextResponse.json(
    {
      events: listAudit(),
      moderation: {
        configured: moderationConfigured(),
        blockedCount: blocks.length,
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
