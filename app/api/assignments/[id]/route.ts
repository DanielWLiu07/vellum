import { NextRequest, NextResponse } from "next/server";
import { enterRequest } from "@/lib/auth";

import { markDone, unassign } from "@/lib/assignments";
import { recordAudit } from "@/lib/audit";
import { getViewer } from "@/lib/profile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function gated() {
  return process.env.VELLUM_DEMO_MODE !== "1"
    ? NextResponse.json({ error: "dashboard_disabled" }, { status: 404 })
    : null;
}

const noStore = { headers: { "Cache-Control": "no-store" } };
const deny = (error: "not_found" | "forbidden") =>
  NextResponse.json({ error }, { status: error === "not_found" ? 404 : 403 });

/**
 * Mark an assignment done. Only the ASSIGNEE may complete their own work - a
 * trainer marking it for them would make the roster's progress meaningless.
 * Body: { status: "done" }.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await enterRequest(req);
  const off = gated();
  if (off) return off;

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object" || (body as { status?: unknown }).status !== "done") {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  const { id } = await params;
  const res = markDone(id, getViewer().owner);
  if (!res.ok) return deny(res.error);
  recordAudit("assignment.complete", res.assignment.title);
  return NextResponse.json({ assignment: res.assignment }, noStore);
}

/** Take an assignment back. Only whoever assigned it, or any admin. */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await enterRequest(req);
  const off = gated();
  if (off) return off;

  const { id } = await params;
  const res = unassign(id, getViewer());
  if (!res.ok) return deny(res.error);
  recordAudit("assignment.unassign", res.assignment.title, `from ${res.assignment.assigneeId}`);
  return NextResponse.json({ ok: true }, noStore);
}
