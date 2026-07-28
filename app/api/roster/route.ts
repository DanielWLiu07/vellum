import { NextRequest, NextResponse } from "next/server";
import { enterRequest } from "@/lib/auth";

import { completionStats } from "@/lib/assignments";
import { getViewer } from "@/lib/profile";
import { canAssign, listKnownUsers, type MemberRole, viewerRole } from "@/lib/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROLES: MemberRole[] = ["student", "trainer", "advisor", "admin"];

function gated() {
  return process.env.VELLUM_DEMO_MODE !== "1"
    ? NextResponse.json({ error: "dashboard_disabled" }, { status: 404 })
    : null;
}

/**
 * Who's in the chapter. Two shapes, depending on who's asking:
 *
 *  - trainer / advisor: their own chapter, WITH each member's completion counts
 *    (the "My group" table). Admin: everyone.
 *  - student: their own chapter, PEOPLE ONLY - so a member can see who their
 *    classmates, trainers, and advisors are. No completion counts, no activity
 *    timestamps: how much work a classmate has and when they last signed in
 *    aren't a peer's business. The reduced payload OMITS those fields rather
 *    than zeroing them, because absent means "not shown" while 0 would read as
 *    "this person has nothing assigned" - and `limited: true` says so outright.
 *
 * `?role=` narrows for everyone; it can only ever remove rows.
 *
 * Only members who have ENTERED Vitals appear here - it has no user list of its
 * own (see lib/users). The UI should say so rather than imply an empty roster
 * means an empty chapter.
 */
export async function GET(req: NextRequest) {
  await enterRequest(req);
  const off = gated();
  if (off) return off;

  const viewer = getViewer();
  const roleParam = req.nextUrl.searchParams.get("role");
  const role = ROLES.find((r) => r === roleParam);
  const roleFilter = role ? { role } : {};

  // A chapter-less viewer scopes to nothing rather than to everyone - the same
  // posture for a student as for a trainer.
  if (!canAssign(viewerRole())) {
    const peers = viewer.chapter ? listKnownUsers({ chapter: viewer.chapter, ...roleFilter }) : [];
    const roster = peers.map((u) => ({ id: u.id, name: u.name, chapter: u.chapter, chapterName: u.chapterName, role: u.role }));
    return NextResponse.json({ roster, scope: "chapter", limited: true }, { headers: { "Cache-Control": "no-store" } });
  }

  const users = viewer.admin
    ? listKnownUsers({ ...roleFilter })
    : viewer.chapter
      ? listKnownUsers({ chapter: viewer.chapter, ...roleFilter })
      : [];

  const stats = completionStats(users.map((u) => u.id));
  const roster = users.map((u) => ({
    id: u.id,
    name: u.name,
    chapter: u.chapter,
    chapterName: u.chapterName,
    role: u.role,
    assigned: stats[u.id]?.assigned ?? 0,
    done: stats[u.id]?.done ?? 0,
    lastSeenAt: u.lastSeenAt,
  }));
  return NextResponse.json({ roster, scope: viewer.admin ? "all" : "chapter" }, { headers: { "Cache-Control": "no-store" } });
}
