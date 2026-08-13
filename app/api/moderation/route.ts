import { NextRequest, NextResponse } from "next/server";

import { recordAudit } from "@/lib/audit";
import { enterRequest } from "@/lib/auth";
import { ensureReady } from "@/lib/bootstrap";
import { moderationConfigured } from "@/lib/moderation";
import {
  holdsVisibility,
  listPending,
  listQueue,
  resolveEntry,
  type QueueEntry,
} from "@/lib/moderation-queue";
import { getViewer } from "@/lib/profile";
import { setShare } from "@/lib/resource-share";
import { banPublicSharing, liftPublicShareBan, listShareBans } from "@/lib/share-ban";
import { getDoc } from "@/lib/store";
import { normalizeVisibility } from "@/lib/visibility";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The moderation review surface. ADMIN ONLY - it exposes other people's held
// content and the ban list.
//
// Deliberately NOT behind VELLUM_DEMO_MODE, unlike /api/audit. A review queue
// that 404s outside the demo is a review queue nobody can drain in the one
// deployment where it matters.

export async function GET(req: NextRequest) {
  await enterRequest(req);
  await ensureReady();
  if (!getViewer().admin) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const pending = listPending();
  return NextResponse.json(
    {
      configured: moderationConfigured(),
      pending,
      pendingCount: pending.length,
      history: listQueue().filter((e) => e.status !== "pending"),
      bans: listShareBans(),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

/**
 * Whether making this resource private would actually hide it.
 *
 * Asked rather than assumed, because writing "private" into the share sidecar
 * is not the same claim as the content being private. Decks and quizzes read
 * their scope from the sidecar, so it lands. A BUNDLED sample's visibility is a
 * constant in lib/store that the sidecar never overrides, and modules (and
 * comments, folders, profiles) have no scope at all — for those, the write is a
 * no-op wearing the costume of a takedown. Reporting an enforcement we didn't
 * get is the same failure as an inert ban, and this queue exists so moderation
 * decisions are not fiction.
 */
async function takedownEnforceable(entry: QueueEntry): Promise<boolean> {
  if (entry.kind === "deck" || entry.kind === "quiz") return true;
  if (entry.kind === "document" || entry.kind === "image") {
    const doc = await getDoc(entry.resourceId);
    return Boolean(doc && !doc.bundled);
  }
  return false;
}

/**
 * Review actions:
 *   { action: "approve", id, note? }   the content stands
 *   { action: "reject",  id, note? }   the content does not
 *   { action: "ban",     owner, reason? }
 *   { action: "unban",   owner }
 *
 * WHAT THOSE VERBS ACT ON is the thing to get right, because a `reported` entry
 * inverts the obvious reading. For the other three reasons the entry IS a hold
 * on the content: approve releases it and restores the scope the creator asked
 * for, reject leaves it private. For a report, nothing is held — the content is
 * live the whole time it sits in the queue — so "approve" could mean either
 * "grant the reporter's request" (take it down) or "the content is approved"
 * (dismiss the report). Those are opposite outcomes behind one button.
 *
 * The object of the verb is the CONTENT, uniformly, for every reason:
 *
 *   approve  the content stands. For a held entry that means releasing it; for
 *            a report it means the complaint didn't land and NOTHING about the
 *            resource changes — not its visibility, not anything.
 *   reject   the content does not stand. For a held entry the hold simply
 *            stays; for a report it is the takedown, and this is the only place
 *            a report ever moves a resource.
 *
 * Content is the object partly because it is what the review card shows (the
 * title, the thumbnail, the owner, an Open button — the reporter's words are
 * one line of context on it), and partly because the alternative reading breaks
 * the pattern the other three reasons already taught the reviewer: approve is
 * the outcome favourable to the owner, reject is the one against them. A verb
 * that flips meaning depending on which row you are looking at is worse than
 * either meaning.
 *
 * The wire actions stay `approve`/`reject` so one code path serves every
 * reason, but the BUTTONS must not: lib/moderation-view's reviewActions() gives
 * a reported entry "Dismiss report" and "Take it down", because a reviewer
 * should never have to know any of the above to press the right one.
 */
export async function POST(req: NextRequest) {
  await enterRequest(req);
  await ensureReady();
  const viewer = getViewer();
  if (!viewer.admin) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const action = typeof body?.action === "string" ? body.action : "";

  if (action === "approve" || action === "reject") {
    const id = typeof body?.id === "string" ? body.id : "";
    const note = typeof body?.note === "string" ? body.note : "";
    const outcome = resolveEntry(id, action === "approve" ? "approved" : "rejected", viewer.owner, note);
    if (!outcome.ok && outcome.reason === "not_found") {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    // Someone got here first. 409 rather than 200, and NO audit line: the log
    // is what a dispute is settled from, so it records decisions that happened
    // and nothing else. The existing entry goes back so the UI can name who
    // decided and what they decided instead of just refusing.
    if (!outcome.ok) {
      return NextResponse.json(
        { error: "already_decided", entry: outcome.entry },
        { status: 409, headers: { "Cache-Control": "no-store" } },
      );
    }
    const entry = outcome.entry;
    const reported = entry.reason === "reported";

    // Restore the requested scope only AFTER the entry stops being pending -
    // while it is pending, clampVisibility would force this straight back to
    // private and the approval would silently do nothing.
    //
    // Gated on holdsVisibility because only an entry that HELD the content has
    // a scope to give back. Approving a report used to land here too, replaying
    // the visibility the resource happened to have when it was reported: Ava
    // publishes, Ben reports, Ava thinks better of it and goes private, a
    // reviewer dismisses the report — and moderation republished the file its
    // owner had withdrawn. Dismissing a report now touches nothing at all.
    if (action === "approve" && holdsVisibility(entry.reason)) {
      setShare(
        entry.resourceId,
        { visibility: normalizeVisibility(entry.requestedVisibility) },
        { visibility: "private", chapter: "" },
        entry.owner,
      );
    }

    // Upholding a report is the one review action that moves a resource the
    // queue was never holding, and it is what a reviewer who AGREES with a
    // report had no way to do: approve restored a scope and reject wrote
    // nothing, so the only lever on reported content was banning its owner.
    // Private rather than deleted, like the console's Take down: reversing a
    // reviewer's mistake must not require the owner's file to still exist.
    // People grants survive (setShare leaves them alone), so the owner and
    // anyone already named on it keep their access while this is sorted out.
    let enforced: boolean | undefined;
    if (action === "reject" && reported) {
      enforced = await takedownEnforceable(entry);
      if (enforced) {
        setShare(entry.resourceId, { visibility: "private" }, { visibility: "private", chapter: "" }, entry.owner);
      }
    }

    // A report's decision gets its own verb in the log. "moderation.approve" on
    // a report is exactly the ambiguity the button labels exist to kill, and an
    // ambiguous audit line is worse than an ambiguous button: nobody is around
    // to ask what it meant.
    const auditAction = reported
      ? action === "approve"
        ? "moderation.report_dismissed"
        : "moderation.report_upheld"
      : `moderation.${action}`;
    recordAudit(
      auditAction,
      entry.title,
      [
        entry.reason,
        ...entry.categories,
        // Say it in the record, not just in the response: a takedown that the
        // resource kind can't carry out is a decision with no effect, and the
        // log should not read as though the content came down.
        enforced === false ? "takedown not enforceable for this kind" : "",
      ]
        .filter(Boolean)
        .join(", "),
      viewer.owner,
    );
    return NextResponse.json(
      { entry, ...(enforced === undefined ? {} : { enforced }) },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  if (action === "ban" || action === "unban") {
    const owner = typeof body?.owner === "string" ? body.owner.trim() : "";
    if (!owner) return NextResponse.json({ error: "owner_required" }, { status: 400 });
    if (owner === viewer.owner) {
      return NextResponse.json({ error: "cannot_ban_self" }, { status: 400 });
    }
    if (action === "ban") {
      const reason = typeof body?.reason === "string" ? body.reason : "";
      const ban = banPublicSharing(owner, viewer.owner, reason);
      recordAudit("moderation.ban", owner, reason, viewer.owner);
      return NextResponse.json({ ban }, { headers: { "Cache-Control": "no-store" } });
    }
    const lifted = liftPublicShareBan(owner);
    recordAudit("moderation.unban", owner, undefined, viewer.owner);
    return NextResponse.json({ lifted }, { headers: { "Cache-Control": "no-store" } });
  }

  return NextResponse.json({ error: "unknown_action" }, { status: 400 });
}
