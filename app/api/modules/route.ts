import { NextRequest, NextResponse } from "next/server";
import { enterRequest } from "@/lib/auth";

import { recordAudit } from "@/lib/audit";
import { createModule, listModules } from "@/lib/modules";
import { flaggedReason, moderateText } from "@/lib/moderation";
import { getViewer } from "@/lib/profile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function gated() {
  return process.env.VELLUM_DEMO_MODE !== "1"
    ? NextResponse.json({ error: "dashboard_disabled" }, { status: 404 })
    : null;
}

/** List modules (metadata only). Any signed-in member can browse. */
export async function GET(req: NextRequest) {
  await enterRequest(req);
  const off = gated();
  if (off) return off;
  return NextResponse.json({ modules: listModules() }, { headers: { "Cache-Control": "no-store" } });
}

/** Create a module - admin only (authoring is HOSA staff work). */
export async function POST(req: NextRequest) {
  await enterRequest(req);
  const off = gated();
  if (off) return off;
  if (!getViewer().admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const body = await req.json().catch(() => null);
  const title = typeof body?.title === "string" ? body.title : "";
  const mod = await moderateText(title);
  if (!mod.allowed) {
    recordAudit("module.blocked", title || "Untitled module", flaggedReason(mod));
    return NextResponse.json({ error: "content_flagged", categories: mod.categories }, { status: 422 });
  }
  const created = createModule(title, getViewer().owner, { summary: body?.summary });
  recordAudit("module.create", created.title);
  return NextResponse.json({ id: created.id, title: created.title }, { headers: { "Cache-Control": "no-store" } });
}
