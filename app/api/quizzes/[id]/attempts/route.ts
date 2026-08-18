import { NextRequest, NextResponse } from "next/server";
import { enterRequest } from "@/lib/auth";

import { getAttempt, listAttempts, unvoidAttempt, voidAttempt } from "@/lib/quiz-attempts";
import { getQuiz } from "@/lib/quizzes";
import { getViewer } from "@/lib/profile";
import { canAssign, getKnownUser, viewerRole } from "@/lib/users";
import { canView } from "@/lib/visibility";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function gated() {
  return process.env.VELLUM_DEMO_MODE !== "1"
    ? NextResponse.json({ error: "dashboard_disabled" }, { status: 404 })
    : null;
}

const notFound = () =>
  NextResponse.json({ error: "not_found" }, { status: 404 });

/**
 * Who may review exam attempts, and WHICH ones.
 *
 * Attempts carry other members' scores and integrity timelines, so this was
 * owner-or-admin: you saw every attempt on a quiz you authored, or none at all.
 * That is the right shape for a quiz and the wrong shape for a chapter. A
 * trainer coaches off HOSA-authored content they did not write, so the scores
 * of the very students they are responsible for were exactly the ones they
 * could never see — the roster gave them "0/0 done" and never a mark.
 *
 * Two answers now, not one:
 *   - owner / admin    -> every attempt on this quiz, unchanged
 *   - trainer/advisor  -> only attempts by members of THEIR chapter
 *
 * The second is enforced by FILTERING ROWS, not by opening the door wider: a
 * trainer on a quiz shared across chapters sees their own members and nobody
 * else's. It is the same boundary /api/assignments already draws ("every
 * assignment in THEIR chapter"), so oversight is scoped one way platform-wide.
 *
 * Chapter staff must also be able to SEE the quiz (canView) before they can
 * review its attempts — otherwise answering 200-with-an-empty-list would
 * confirm the existence of another chapter's private quiz, which is the leak
 * the blanket 404 was there to prevent.
 */
type ReviewGate =
  | { ok: false; res: NextResponse }
  | { ok: true; scope: "all" }
  | { ok: true; scope: "chapter"; chapter: string };

function reviewGate(id: string): ReviewGate {
  const quiz = getQuiz(id);
  if (!quiz) return { ok: false, res: notFound() };
  const viewer = getViewer();
  if (viewer.admin || quiz.owner === viewer.owner) return { ok: true, scope: "all" };
  if (canAssign(viewerRole()) && viewer.chapter && canView(quiz, viewer)) {
    return { ok: true, scope: "chapter", chapter: viewer.chapter };
  }
  return { ok: false, res: notFound() };
}

/**
 * List exam attempts for this quiz, scoped per reviewGate.
 *
 * A taker the signed directory doesn't know is omitted from a chapter-scoped
 * list rather than included: an attempt that can't be attributed to a chapter
 * can't be shown to be in one, and guessing in the permissive direction is how
 * one chapter's scores end up on another chapter's screen.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await enterRequest(req);
  const off = gated();
  if (off) return off;
  const { id } = await params;
  const gate = reviewGate(id);
  if (!gate.ok) return gate.res;
  const all = listAttempts(id);
  const attempts =
    gate.scope === "all"
      ? all
      : all.filter((a) => getKnownUser(a.taker)?.chapter === gate.chapter);
  return NextResponse.json(
    { attempts, scope: gate.scope },
    { headers: { "Cache-Control": "no-store" } },
  );
}

/**
 * Void or reinstate one attempt (owner/admin override of the auto-void).
 *
 * Deliberately NOT widened to chapter staff along with the read. Voiding is a
 * ruling on a member's exam, not a look at it, and nobody asked for trainers to
 * be able to strike their own students' results. Reading was the gap; this can
 * be opened later on purpose if it turns out to be one, which is the safer
 * order to discover that in.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await enterRequest(req);
  const off = gated();
  if (off) return off;
  const { id } = await params;
  const gate = reviewGate(id);
  if (!gate.ok) return gate.res;
  if (gate.scope !== "all") return notFound();

  const body = await req.json().catch(() => null);
  const attemptId = typeof body?.attemptId === "string" ? body.attemptId : "";
  const attempt = getAttempt(attemptId);
  // The attempt must belong to THIS quiz - stops voiding another quiz's attempt
  // by passing a foreign id to a quiz you happen to own.
  if (!attempt || attempt.quizId !== id) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const updated =
    body?.void === false
      ? unvoidAttempt(attemptId)
      : voidAttempt(attemptId, typeof body?.reason === "string" ? body.reason : "Voided by reviewer");
  return NextResponse.json({ attempt: updated }, { headers: { "Cache-Control": "no-store" } });
}
