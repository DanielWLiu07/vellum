import { NextRequest, NextResponse } from "next/server";

import { recordAudit } from "@/lib/audit";
import { enterRequest } from "@/lib/auth";
import { getDeck } from "@/lib/decks";
import { getModule } from "@/lib/modules";
import { enqueue, pendingReportBy, type QueueKind } from "@/lib/moderation-queue";
import { getViewer } from "@/lib/profile";
import { getQuiz } from "@/lib/quizzes";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { getDoc } from "@/lib/store";
import { canView } from "@/lib/visibility";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// "This shouldn't be here" — a member reporting content to a human reviewer.
//
// Deliberately NOT the same thing as /api/feedback. Feedback is a message to
// staff ("question 4's answer key is wrong") and is answered by correcting
// something. A report is an accusation about content and is answered by a
// moderation decision, so it lands in the same review queue as the automatic
// flags rather than in a separate inbox nobody drains.
//
// What this route does NOT do is change what anyone can see. Enqueuing a report
// leaves the resource exactly as visible as it was, and lib/moderation-queue's
// isQuarantined skips `reported` entries so nothing downstream quietly clamps
// it either. One member must not be able to pull another member's work offline
// by pressing a button — that is the reviewer's call, and until they make it
// the material stays up. The compensating control is triage order: reported
// items are shown to reviewers ahead of everything else.

function gated() {
  return process.env.VELLUM_DEMO_MODE !== "1"
    ? NextResponse.json({ error: "dashboard_disabled" }, { status: 404 })
    : null;
}

type ReportKind = "doc" | "deck" | "quiz" | "module";

function normalizeKind(v: unknown): ReportKind | null {
  return v === "doc" || v === "deck" || v === "quiz" || v === "module" ? v : null;
}

const REASON_MAX = 1000;

interface Target {
  kind: QueueKind;
  owner: string;
  title: string;
}

/**
 * Resolve a report target, but only if the reporter can actually see it.
 *
 * Same shape as targetOk in app/api/comments: an invisible target and a
 * non-existent one both come back null and the route answers 404 for both, so
 * the endpoint can't be walked to discover which ids exist. Reporting is a
 * tempting probe precisely because it feels like it should accept anything.
 */
async function resolveTarget(kind: ReportKind, id: string): Promise<Target | null> {
  const viewer = getViewer();
  if (kind === "doc") {
    const doc = await getDoc(id);
    return doc && canView(doc, viewer) ? { kind: "document", owner: doc.owner, title: doc.name } : null;
  }
  if (kind === "deck") {
    const deck = getDeck(id);
    return deck && canView(deck, viewer) ? { kind: "deck", owner: deck.owner, title: deck.title } : null;
  }
  if (kind === "quiz") {
    const quiz = getQuiz(id);
    return quiz && canView(quiz, viewer) ? { kind: "quiz", owner: quiz.owner, title: quiz.title } : null;
  }
  const mod = getModule(id);
  // Modules carry no share state — every signed-in member can open any of
  // them — so existence IS the visibility check, exactly as /api/comments
  // treats them.
  return mod ? { kind: "module", owner: mod.owner, title: mod.title } : null;
}

/** Report a resource for human review. Any signed-in member may do this. */
export async function POST(req: NextRequest) {
  await enterRequest(req);
  const off = gated();
  if (off) return off;

  // Tighter than comments (20/min) and feedback (10/min). A real report is one
  // request that someone stopped to write; a burst is either a stuck dialog or
  // an attempt to bury the queue, and neither deserves headroom. Per-IP like
  // the rest, so a school behind one NAT shares the budget — five a minute is
  // still far above what a classroom of honest reporters produces.
  const rl = rateLimit(`report:${clientIp(req)}`, 5, 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter), "Cache-Control": "no-store" } },
    );
  }

  const viewer = getViewer();
  // A report is worth having only if it is attributable: the reviewer has to be
  // able to weigh who is complaining, and an anonymous queue entry is something
  // anyone can generate. getViewer() resolves to an empty owner when there is
  // no session (lib/profile's NOBODY), so this is the signed-in check.
  if (!viewer.owner) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const kind = normalizeKind(body?.kind);
  const id = typeof body?.id === "string" ? body.id : "";
  const reason = (typeof body?.reason === "string" ? body.reason : "").trim().slice(0, REASON_MAX);
  if (!kind || !id) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  // The reason is required, unlike a feedback message's optional target. A
  // report with no words is a vote against something with no case attached, and
  // a reviewer can do nothing with it except guess.
  if (!reason) return NextResponse.json({ error: "reason_required" }, { status: 400 });

  const target = await resolveTarget(kind, id);
  if (!target) return NextResponse.json({ error: "not_found" }, { status: 404 });

  // Idempotent-ish: a second report of the same thing by the same person
  // returns their existing open entry instead of adding another. The dialog can
  // then say "we already have this" rather than pretending a fresh report was
  // filed. Once a reviewer resolves it, the same member reporting again DOES
  // open a new entry — that is a genuinely new claim about a decided case.
  const existing = pendingReportBy(id, viewer.owner);
  if (existing) {
    return NextResponse.json(
      { ok: true, id: existing.id, duplicate: true },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  // The reason text is NOT run through moderateText, for the same reason
  // lib/feedback isn't: someone describing content that upset them will use the
  // words that upset them, and a filter that rejects the description silences
  // exactly the reports worth reading. It goes to admins only, never to another
  // member, so there is no audience to protect from it.
  const entry = enqueue({
    resourceId: id,
    kind: target.kind,
    owner: target.owner,
    title: target.title,
    reason: "reported",
    reportedBy: viewer.owner,
    reportReason: reason,
    // requestedVisibility is deliberately NOT set. It exists so approving a
    // HELD entry can give back the scope its creator asked for, and a report
    // holds nothing — there is nothing to give back. Recording the scope the
    // resource had at report time looked harmless and wasn't: /api/moderation
    // replayed it on approval, so dismissing Ben's report re-published a file
    // Ava had made private in the days since. The review route now refuses to
    // restore anything for a report (see holdsVisibility); leaving this unset
    // means there is also nothing left lying around for it to restore.
  });

  recordAudit("content.report", target.title, reason, viewer.owner);
  return NextResponse.json({ ok: true, id: entry.id }, { headers: { "Cache-Control": "no-store" } });
}
