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
import { notify } from "@/lib/notifications";
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
 * Where a notification about this assignment should land. A same-origin path
 * only - lib/notifications drops anything else, and rightly so: a notification
 * is a link arriving from somewhere the member did not choose.
 *
 * Twin of refHref in components/use-assignments, kept separate rather than
 * imported because that module is a client component and this is a route.
 */
function assignmentHref(a: { kind: string; refId: string; parts?: { id: string }[] }): string {
  if (a.kind === "doc") return `/view/${a.refId}`;
  if (a.kind === "deck") return `/decks/${a.refId}`;
  if (a.kind === "quiz") return `/quizzes/${a.refId}`;
  if (!a.parts?.length) return `/modules/${a.refId}`;
  return `/modules/${a.refId}?parts=${encodeURIComponent(a.parts.map((p) => p.id).join(","))}`;
}

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
 * Body: { kind: "doc"|"deck"|"quiz"|"module", refId, assigneeId, dueAt?, parts? }
 *
 * `parts` is a list of SECTION IDS narrowing a module assignment to part of the
 * module. Ids only - the section titles shown to the student are read out of
 * the module server-side, exactly as `title` is, so a label cannot be smuggled
 * in through this field.
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
    parts: b.parts,
  });
  if (!res.ok) {
    const status = res.error === "bad_ref" ? 404 : 400;
    return NextResponse.json({ error: res.error === "bad_ref" ? "unknown_ref" : res.error }, { status });
  }
  // A repeat of an assignment the member already has open isn't a new event -
  // no log line, and no second notification for work they already have.
  if (!res.duplicate) {
    const a = res.assignment;
    const parts = a.parts;
    // Record WHICH parts, not just the module: "assigned EMT Fundamentals"
    // reads as the whole thing when it may have been one section of six.
    const scope = parts?.length ? ` (${parts.length} part${parts.length === 1 ? "" : "s"})` : "";
    recordAudit("assignment.create", a.title, `${a.kind}${scope} -> ${target.name}`);

    // Tell the member. Until now nothing did: work was handed out silently and
    // a student found it only by chance, which is the gap the architecture doc
    // calls the highest-impact one in the product.
    //
    // Grouped per assigner, so a trainer handing five things to one member in
    // one sitting is one event to that member rather than five pings. `actor`
    // lets lib/notifications drop it outright when someone assigns to
    // themselves, instead of every call site having to remember that rule.
    notify({
      to: a.assigneeId,
      actor: viewer.owner,
      kind: "assignment.new",
      title: parts?.length ? `${a.title} — ${parts.map((p) => p.title).join(", ")}` : a.title,
      body: `${a.assignedByName} assigned you this ${a.kind === "doc" ? "document" : a.kind}.`,
      href: assignmentHref(a),
      groupKey: `assign:${viewer.owner}`,
      groupTitle: "{n} new assignments",
    });
  }
  return NextResponse.json({ assignment: res.assignment, duplicate: res.duplicate }, noStore);
}
