import { NextRequest, NextResponse } from "next/server";
import { enterRequest } from "@/lib/auth";

import { setStatus, unassign, type AssignmentStatus } from "@/lib/assignments";
import { recordAudit } from "@/lib/audit";
import { notify } from "@/lib/notifications";
import { getKnownUser } from "@/lib/users";
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
 * Set an assignment's status. Only the ASSIGNEE may change their own work - a
 * trainer marking it for them would make the roster's progress meaningless.
 * Body: { status: "done" | "todo" }.
 *
 * "todo" reopens. It used to be rejected, which made completion a one-way door:
 * a mis-tap was permanent, and the trainer's count was then wrong with nothing
 * either party could do about it.
 */
const STATUSES: AssignmentStatus[] = ["done", "todo"];

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await enterRequest(req);
  const off = gated();
  if (off) return off;

  const body = await req.json().catch(() => null);
  const wanted = (body as { status?: unknown } | null)?.status;
  const status = STATUSES.find((s) => s === wanted);
  if (!status) return NextResponse.json({ error: "bad_request" }, { status: 400 });

  const { id } = await params;
  const res = setStatus(id, getViewer().owner, status);
  if (!res.ok) return deny(res.error);
  // Distinct actions: "completed it" and "took it back" are different events to
  // anyone reading the log, and collapsing them loses the reopen entirely.
  recordAudit(status === "done" ? "assignment.complete" : "assignment.reopen", res.assignment.title);

  // The other direction of the loop: the trainer's progress count just moved,
  // and until now they had to go looking to find out. A reopen is reported as
  // plainly as a completion - a count quietly going back down, unexplained, is
  // worse for them than being told.
  //
  // Self-assigned work notifies nobody: `actor` and the recipient are the same
  // member, and lib/notifications drops it.
  const a = res.assignment;
  const who = getKnownUser(a.assigneeId)?.name || "A member";
  notify({
    to: a.assignedBy,
    actor: getViewer().owner,
    kind: status === "done" ? "assignment.done" : "assignment.reopened",
    title: status === "done" ? `${who} completed "${a.title}"` : `${who} reopened "${a.title}"`,
    href: "/dashboard?section=assigned",
    groupKey: `progress:${a.assigneeId}`,
    groupTitle: `{n} updates from ${who}`,
  });

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
