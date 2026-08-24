import { NextRequest, NextResponse } from "next/server";
import { enterRequest } from "@/lib/auth";

import { recordAudit } from "@/lib/audit";
import { flaggedReason, moderateText } from "@/lib/moderation";
import { deleteQueueFor, describeOpenReview, enqueue, isQuarantined } from "@/lib/moderation-queue";
import { resolvePublish } from "@/lib/publish";
import { type QuizQuestion, coerceChoice, deleteQuiz, examWindowState, getQuiz, getQuizForTaker, updateQuiz } from "@/lib/quizzes";
import { deleteShare, setShare } from "@/lib/resource-share";
import { deleteFavoritesFor } from "@/lib/favorites";
import { getViewer } from "@/lib/profile";
import { canEdit, canManageSharing, canView, normalizePeople, normalizeVisibility } from "@/lib/visibility";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function gated() {
  return process.env.VELLUM_DEMO_MODE !== "1"
    ? NextResponse.json({ error: "dashboard_disabled" }, { status: 404 })
    : null;
}

// Returns the quiz WITHOUT the correct answers (those stay server-side).
// `?edit=1` returns the full quiz including the answer key — but only for
// someone allowed to edit it; a taker can never pull the key this way.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await enterRequest(req);
  const off = gated();
  if (off) return off;
  const { id } = await params;
  const scoped = getQuiz(id);
  if (!scoped) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!canView(scoped, getViewer())) return NextResponse.json({ error: "not_found" }, { status: 404 }); // no existence leak

  const editable = scoped.id !== "sample-quiz" && canEdit(scoped, getViewer());
  if (req.nextUrl.searchParams.get("edit") === "1") {
    if (!editable) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    return NextResponse.json({ quiz: scoped, canEdit: true }, { headers: { "Cache-Control": "no-store" } });
  }
  // A scheduled exam is not fetchable outside its window: the questions ARE the
  // exam, so handing them over early is handing over the paper early. Whoever
  // may edit it is exempt — they need to check their own exam before it opens,
  // and they can read the questions in the editor regardless.
  const window = examWindowState(scoped.exam, Date.now());
  if (window !== "open" && !editable) {
    return NextResponse.json(
      {
        error: window === "upcoming" ? "exam_not_open" : "exam_closed",
        ...(scoped.exam?.opensAt !== undefined ? { opensAt: scoped.exam.opensAt } : {}),
        ...(scoped.exam?.closesAt !== undefined ? { closesAt: scoped.exam.closesAt } : {}),
      },
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );
  }
  const quiz = getQuizForTaker(id)!;
  return NextResponse.json({ quiz, canEdit: editable }, { headers: { "Cache-Control": "no-store" } });
}

// Edit a quiz in place (title/questions) and/or update its sharing
// (visibility, chapter, people). Owner or a granted editor only; the sample
// is immutable.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await enterRequest(req);
  const off = gated();
  if (off) return off;
  const { id } = await params;
  const quiz = getQuiz(id);
  if (!quiz) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!canView(quiz, getViewer())) return NextResponse.json({ error: "not_found" }, { status: 404 }); // no existence leak
  if (id === "sample-quiz" || !canEdit(quiz, getViewer())) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  // Sharing changes (any subset; untouched fields are preserved). Only the
  // owner/admin may change WHO can see a quiz — editors edit content only.
  // Check this BEFORE mutating content so a mixed request can't half-apply.
  const share: Parameters<typeof setShare>[1] = {};
  if (body.visibility !== undefined) share.visibility = normalizeVisibility(body.visibility);
  if (typeof body.chapter === "string") share.chapter = body.chapter.trim();
  if (body.people !== undefined) share.people = normalizePeople(body.people, quiz.owner);
  const wantsSharing = Object.keys(share).length > 0;
  if (wantsSharing && !canManageSharing(quiz, getViewer())) {
    return NextResponse.json({ error: "forbidden_sharing" }, { status: 403 });
  }

  // Content changes.
  const patch: { title?: string; questions?: QuizQuestion[]; exam?: unknown } = {};
  if (typeof body.title === "string") patch.title = body.title;
  if (Array.isArray(body.questions)) {
    patch.questions = (body.questions as unknown[])
      .filter((q): q is Record<string, unknown> => Boolean(q) && typeof q === "object")
      .map((q) => ({
        prompt: String(q.prompt ?? ""),
        choices: Array.isArray(q.choices) ? q.choices.map(coerceChoice) : [],
        correctIndex: Number(q.correctIndex ?? 0),
        ...(typeof q.promptImageId === "string" && q.promptImageId ? { promptImageId: q.promptImageId } : {}),
      }));
  }
  // exam: an object turns exam mode on (with a time limit); null turns it off.
  if (body.exam !== undefined) patch.exam = body.exam === null ? null : body.exam;

  if (patch.title !== undefined || patch.questions !== undefined) {
    // Moderate edits too, so a benign quiz can't be edited into harmful content.
    const mod = await moderateText(
      [patch.title ?? quiz.title, ...(patch.questions ?? []).flatMap((q) => [q.prompt, ...q.choices.map((c) => c.text)])]
        .filter(Boolean)
        .join("\n"),
    );
    if (!mod.allowed) {
      recordAudit("quiz.blocked", (patch.title ?? quiz.title) || "Untitled quiz", flaggedReason(mod));
      return NextResponse.json({ error: "content_flagged", categories: mod.categories }, { status: 422 });
    }
  }
  if (patch.title !== undefined || patch.questions !== undefined || patch.exam !== undefined) {
    if (!updateQuiz(id, patch)) {
      return NextResponse.json({ error: "no_questions" }, { status: 400 });
    }
  }

  // Going public is a submission, not a setting: it puts the quiz in front of
  // every HOSA member in the country, which is the same exposure a document
  // carries and gets the same answer. Chapter and private stay the owner's own
  // call, and an admin publishes directly - see lib/publish for where the line
  // sits. Captured before the decision rewrites it, so a clamp can be compared
  // against what the owner actually asked for.
  const requestedVisibility = share.visibility;
  let submitted = false;
  // Read the hold BEFORE anything is enqueued. A pending submission counts as a
  // hold, so queuing first would make the clamp below force this very quiz to
  // private - charging the owner the audience they already had as the price of
  // asking about a wider one, which is the outcome lib/publish exists to avoid.
  const heldForReview = isQuarantined(id);
  if (share.visibility !== undefined) {
    const decision = resolvePublish({
      requested: share.visibility,
      current: quiz.visibility,
      isAdmin: getViewer().admin,
    });
    share.visibility = decision.visibility;
    submitted = decision.submitted;
  }

  // Seed the defaults from the quiz's CURRENT scope. The literal that used to
  // sit here restated lib/quizzes' own fallback for a quiz with no share row, so
  // the two could only ever drift apart - and every drift would be a people-only
  // update handing the quiz to an audience nobody asked for.
  if (wantsSharing) setShare(id, share, { visibility: quiz.visibility, chapter: quiz.chapter });

  const updated = getQuiz(id)!;
  if (submitted && !heldForReview) {
    enqueue({
      resourceId: id,
      kind: "quiz",
      owner: quiz.owner,
      title: updated.title,
      reason: "submitted",
      requestedVisibility: "public",
    });
    recordAudit("quiz.submitted", updated.title);
  }
  recordAudit("quiz.update", updated.title);
  return NextResponse.json(
    {
      id: updated.id,
      title: updated.title,
      questionCount: updated.questions.length,
      visibility: updated.visibility,
      people: updated.people,
      // Held at a narrower scope pending review - say so, or the share dialog
      // reports the save it asked for and shows the old scope on refresh.
      ...(submitted ? { submittedForReview: true } : {}),
      // A scope refused outright rather than queued: a held quiz, or an owner
      // banned from public sharing. Reporting {ok} without this is how "I
      // clicked Share and nothing moved" became a bug with no explanation
      // anywhere.
      ...(!submitted && requestedVisibility !== undefined && updated.visibility !== requestedVisibility
        ? {
            clamped: true,
            clampedTo: updated.visibility,
            clampedReason: heldForReview ? "held_for_review" : "sharing_restricted",
          }
        : {}),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await enterRequest(req);
  const off = gated();
  if (off) return off;
  const { id } = await params;
  const quiz = getQuiz(id);
  if (!quiz) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!canView(quiz, getViewer())) return NextResponse.json({ error: "not_found" }, { status: 404 }); // no existence leak
  // Deleting is owner-only (editors can change content, not destroy it).
  if (quiz.owner !== getViewer().owner && !getViewer().admin) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (!deleteQuiz(id)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  deleteShare(id); // drop sidecar entries so they don't accumulate as orphans
  deleteFavoritesFor(id);
  recordAudit("quiz.delete", quiz.title);
  // Same cleanup and the same second line as the document and deck paths. See
  // deleteQueueFor for why deleting under review is allowed but not silent.
  const openReview = deleteQueueFor(id);
  if (openReview.length > 0) {
    recordAudit("moderation.deleted_under_review", quiz.title, describeOpenReview(openReview));
  }
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
