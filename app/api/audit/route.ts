import { NextRequest, NextResponse } from "next/server";
import { enterRequest } from "@/lib/auth";

import { listAudit, listModerationBlocks } from "@/lib/audit";
import { moderationHealth } from "@/lib/moderation";
import { listPending } from "@/lib/moderation-queue";
import { getViewer } from "@/lib/profile";
import { storageHealth } from "@/lib/storage";

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
  // `configured` alone said "On" straight through a total outage. Liveness and
  // the unchecked backlog are what tell an operator the difference between a
  // quiet system and a blind one.
  const health = moderationHealth();
  const heldUnchecked = listPending().filter((e) => e.reason === "unchecked").length;
  return NextResponse.json(
    {
      events: listAudit(),
      moderation: {
        ...health,
        blockedCount: blocks.length,
        heldUnchecked,
      },
      // Uploads have no snapshot behind them, so "is anything being kept?" is
      // a question only this answers.
      storage: storageHealth(),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
