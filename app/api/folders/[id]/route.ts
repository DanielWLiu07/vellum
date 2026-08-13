import { NextRequest, NextResponse } from "next/server";
import { enterRequest } from "@/lib/auth";

import { recordAudit } from "@/lib/audit";
import { deleteFolder, getFolder, renameFolder } from "@/lib/folders";
import { moderateText } from "@/lib/moderation";
import { holdlessDisposition } from "@/lib/moderation-gate";
import { getViewer } from "@/lib/profile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function gated() {
  return process.env.VELLUM_DEMO_MODE !== "1"
    ? NextResponse.json({ error: "dashboard_disabled" }, { status: 404 })
    : null;
}

// Only the folder's owner may change it; official folders are admin-only.
function canManage(id: string): { ok: boolean; status?: number } {
  const f = getFolder(id);
  if (!f) return { ok: false, status: 404 };
  const viewer = getViewer();
  if (f.official) return viewer.admin ? { ok: true } : { ok: false, status: 403 };
  return f.owner === viewer.owner || viewer.admin ? { ok: true } : { ok: false, status: 403 };
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await enterRequest(req);
  const off = gated();
  if (off) return off;
  const { id } = await params;
  const gate = canManage(id);
  if (!gate.ok) return NextResponse.json({ error: "forbidden" }, { status: gate.status });

  const body = await req.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  // Same as the create path: a rename has nothing to hold, so both refusals
  // leave the folder under its existing name. See holdlessDisposition.
  const verdict = holdlessDisposition(await moderateText(name));
  if (verdict.action === "refuse" && verdict.reason === "unchecked") {
    recordAudit("folder.blocked", name, "not checked - moderation unavailable");
    return NextResponse.json(
      { error: "moderation_unavailable" },
      { status: 503, headers: { "Retry-After": "60", "Cache-Control": "no-store" } },
    );
  }
  if (verdict.action === "refuse") {
    recordAudit("folder.blocked", name, verdict.categories.join(", "));
    return NextResponse.json({ error: "content_flagged", categories: verdict.categories }, { status: 422 });
  }
  const folder = renameFolder(id, name);
  if (!folder) return NextResponse.json({ error: "not_found" }, { status: 404 });
  recordAudit("folder.update", folder.name);
  return NextResponse.json({ folder }, { headers: { "Cache-Control": "no-store" } });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await enterRequest(req);
  const off = gated();
  if (off) return off;
  const { id } = await params;
  const gate = canManage(id);
  if (!gate.ok) return NextResponse.json({ error: "forbidden" }, { status: gate.status });
  const f = getFolder(id);
  deleteFolder(id);
  // Resources keep their (now dangling) folderId; the UI treats it as unfiled.
  if (f) recordAudit("folder.delete", f.name);
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
