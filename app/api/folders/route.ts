import { NextRequest, NextResponse } from "next/server";
import { enterRequest } from "@/lib/auth";

import { recordAudit } from "@/lib/audit";
import { createFolder, listFolders } from "@/lib/folders";
import { moderateText } from "@/lib/moderation";
import { holdlessDisposition } from "@/lib/moderation-gate";
import { getViewer } from "@/lib/profile";
import { clientIp, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function gated() {
  return process.env.VELLUM_DEMO_MODE !== "1"
    ? NextResponse.json({ error: "dashboard_disabled" }, { status: 404 })
    : null;
}

/** Folders the viewer can see: every official folder plus their own. */
export async function GET(req: NextRequest) {
  await enterRequest(req);
  const off = gated();
  if (off) return off;
  return NextResponse.json({ folders: listFolders(getViewer().owner) }, { headers: { "Cache-Control": "no-store" } });
}

/** Create a folder. Official folders are admin-only; names are moderated. */
export async function POST(req: NextRequest) {
  await enterRequest(req);
  const off = gated();
  if (off) return off;
  const rl = rateLimit(`folders:${clientIp(req)}`, 20, 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter), "Cache-Control": "no-store" } },
    );
  }
  const body = await req.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  const official = body?.official === true;
  const viewer = getViewer();
  if (official && !viewer.admin) {
    return NextResponse.json({ error: "admin_only" }, { status: 403 });
  }
  // A folder name is a label on a container, not a document: there is nothing
  // to store privately pending review, so a hold has no meaning here (see
  // holdlessDisposition). Refusing costs a rename.
  const gate = holdlessDisposition(await moderateText(name));
  if (gate.action === "refuse" && gate.reason === "unchecked") {
    // Previously this passed: a skipped check is allowed:true, so an outage
    // meant folder names were stored unexamined and recorded as clean.
    recordAudit("folder.blocked", name, "not checked - moderation unavailable");
    return NextResponse.json(
      { error: "moderation_unavailable" },
      { status: 503, headers: { "Retry-After": "60", "Cache-Control": "no-store" } },
    );
  }
  if (gate.action === "refuse") {
    recordAudit("folder.blocked", name, gate.categories.join(", "));
    return NextResponse.json({ error: "content_flagged", categories: gate.categories }, { status: 422 });
  }
  const folder = createFolder(name, viewer.owner, official);
  recordAudit("folder.create", folder.name);
  return NextResponse.json({ folder }, { headers: { "Cache-Control": "no-store" } });
}
