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
import { dueRaises } from "@/lib/due-sweep";
import { hasRaised, notify } from "@/lib/notifications";
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
 * Raise any due-date notices this member has earned but not yet been told.
 *
 * Vitals has no scheduler (see lib/due-sweep), so the sweep rides on the read:
 * whenever someone loads their own work, we catch up on what should have fired.
 *
 * NO `actor`. Everywhere else, passing the actor is what stops a member being
 * notified about their own action - but a deadline is not an action anybody
 * took, and this runs while the member themselves is reading. Passing
 * `actor: owner` here would make actor === to on every single call and
 * lib/notifications would correctly drop all of them, so the feature would
 * deliver precisely nothing. The absence is the point; do not "fix" it.
 *
 * Best-effort: a failure here must not take down the list the member asked
 * for. They would lose a reminder, not their work.
 */
function sweepOwnDueDates(owner: string): void {
  try {
    const raises = dueRaises(listAssignmentsFor(owner), Date.now(), (key) => hasRaised(owner, key));
    for (const r of raises) {
      const a = r.assignment;
      const soon = r.kind === "assignment.due_soon";
      notify({
        to: owner,
        kind: r.kind,
        title: soon ? `${a.title} is due soon` : `${a.title} is overdue`,
        body: a.dueAt
          ? `${soon ? "Due" : "Was due"} ${new Date(a.dueAt).toISOString().slice(0, 10)}. Assigned by ${a.assignedByName}.`
          : undefined,
        href: assignmentHref(a),
        groupKey: r.groupKey,
      });
    }
  } catch {
    /* a missed reminder is not worth failing the request over */
  }
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

  // Always the READER's own work, whatever scope they are about to be served -
  // a trainer has deadlines too, and theirs are swept on the same read.
  sweepOwnDueDates(viewer.owner);

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
