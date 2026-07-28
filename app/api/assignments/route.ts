import { NextRequest, NextResponse } from "next/server";
import { enterRequest } from "@/lib/auth";

import {
  createAssignment,
  isAssignmentKind,
  listAllAssignments,
  listAssignmentsBy,
  listAssignmentsFor,
} from "@/lib/assignments";
import { recordAudit } from "@/lib/audit";
import { getProfile, getViewer } from "@/lib/profile";
import { canAssign, getKnownUser, viewerRole } from "@/lib/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ID_MAX = 128;

function gated() {
  return process.env.VELLUM_DEMO_MODE !== "1"
    ? NextResponse.json({ error: "dashboard_disabled" }, { status: 404 })
    : null;
}

const noStore = { headers: { "Cache-Control": "no-store" } };

/**
 * List assignments, scoped to what the caller is allowed to see:
 *   - student          -> their own, and only their own
 *   - trainer/advisor  -> every assignment in THEIR chapter
 *   - admin            -> all of them
 * `?assignee=<id>` narrows the list, but never widens it: for a trainer it
 * still filters within their chapter, and a student's own list ignores it.
 */
export async function GET(req: NextRequest) {
  await enterRequest(req);
  const off = gated();
  if (off) return off;

  const viewer = getViewer();
  const role = viewerRole();
  const assignee = (req.nextUrl.searchParams.get("assignee") ?? "").trim().slice(0, ID_MAX);

  if (!canAssign(role)) {
    return NextResponse.json({ assignments: listAssignmentsFor(viewer.owner), scope: "self" }, noStore);
  }
  if (viewer.admin) {
    const assignments = assignee ? listAssignmentsFor(assignee) : listAllAssignments();
    return NextResponse.json({ assignments, scope: "all" }, noStore);
  }
  const chapter = listAssignmentsBy(viewer.chapter);
  const assignments = assignee ? chapter.filter((a) => a.assigneeId === assignee) : chapter;
  return NextResponse.json({ assignments, scope: "chapter" }, noStore);
}

/**
 * Assign content to a member. Trainers and advisors may only assign within
 * their own chapter; an admin may assign to anyone Vitals knows. The assignee's
 * chapter comes from the SIGNED user directory (lib/users), not from the
 * request and not from the member's editable profile, so "assign cross-chapter"
 * can't be arranged by editing a profile field.
 *
 * Body: { kind: "doc"|"deck"|"quiz"|"module", refId, assigneeId, dueAt? }
 */
export async function POST(req: NextRequest) {
  await enterRequest(req);
  const off = gated();
  if (off) return off;

  const viewer = getViewer();
  if (!canAssign(viewerRole())) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "bad_request" }, { status: 400 });
  const b = body as Record<string, unknown>;
  if (!isAssignmentKind(b.kind)) return NextResponse.json({ error: "bad_kind" }, { status: 400 });

  const assigneeId = String(b.assigneeId ?? "").trim().slice(0, ID_MAX);
  if (!assigneeId) return NextResponse.json({ error: "bad_request" }, { status: 400 });

  // Only members Vitals has seen can be assigned to - see the roster limitation
  // in lib/users. This is also what makes the chapter check below meaningful.
  const target = getKnownUser(assigneeId);
  if (!target) return NextResponse.json({ error: "unknown_assignee" }, { status: 404 });
  if (!viewer.admin && (!viewer.chapter || target.chapter !== viewer.chapter)) {
    return NextResponse.json({ error: "cross_chapter" }, { status: 403 });
  }

  const res = await createAssignment({
    kind: b.kind,
    refId: b.refId,
    assigneeId: target.id,
    assignedBy: viewer.owner,
    assignedByName: getKnownUser(viewer.owner)?.name || getProfile().displayName,
    chapter: target.chapter,
    dueAt: b.dueAt,
  });
  if (!res.ok) {
    const status = res.error === "bad_ref" ? 404 : 400;
    return NextResponse.json({ error: res.error === "bad_ref" ? "unknown_ref" : res.error }, { status });
  }
  // A repeat of an assignment the member already has open isn't a new event.
  if (!res.duplicate) recordAudit("assignment.create", res.assignment.title, `${res.assignment.kind} -> ${target.name}`);
  return NextResponse.json({ assignment: res.assignment, duplicate: res.duplicate }, noStore);
}
