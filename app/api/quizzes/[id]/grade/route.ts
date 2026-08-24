import { NextRequest, NextResponse } from "next/server";
import { enterRequest } from "@/lib/auth";

import { recordAttempt } from "@/lib/quiz-attempts";
import { examWindowState, getQuiz, gradeQuiz } from "@/lib/quizzes";
import { getViewer } from "@/lib/profile";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { canEdit, canView } from "@/lib/visibility";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Scores submitted answers server-side against the answer key.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await enterRequest(req);
  if (process.env.VELLUM_DEMO_MODE !== "1") {
    return NextResponse.json({ error: "dashboard_disabled" }, { status: 404 });
  }
  // Grading is a write: every exam submission persists an attempt. Left
  // unlimited it was the one way a member could grow the attempt store in a
  // loop, which is also how eviction became a deletion primitive (see
  // MAX_ATTEMPTS_PER_TAKER in lib/quiz-attempts). Generous enough that
  // practice-mode retries and a legitimate re-sit never touch it.
  const rl = rateLimit(`grade:${clientIp(req)}`, 30, 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter), "Cache-Control": "no-store" } },
    );
  }
  const { id } = await params;
  // Same access gate as reading the quiz — grading returns the answer key,
  // so a private quiz must not be gradeable by someone who can't view it.
  const scoped = getQuiz(id);
  if (scoped && !canView(scoped, getViewer())) {
    return NextResponse.json({ error: "not_found" }, { status: 404 }); // no existence leak
  }
  // The scheduled window is enforced on SUBMIT as well as on read, and this is
  // the half that makes it a schedule rather than a hint. Blocking only the
  // fetch leaves a tab opened one minute before the close able to submit hours
  // later, and leaves the API openly gradeable by anyone who skips the UI. An
  // editor is exempt on both boundaries alike, so checking their own exam
  // end-to-end before it opens still works.
  if (scoped?.exam && !canEdit(scoped, getViewer())) {
    const window = examWindowState(scoped.exam, Date.now());
    if (window !== "open") {
      return NextResponse.json(
        { error: window === "upcoming" ? "exam_not_open" : "exam_closed" },
        { status: 403, headers: { "Cache-Control": "no-store" } },
      );
    }
  }
  const body = await req.json().catch(() => null);
  const answers = Array.isArray(body?.answers) ? body.answers.map((a: unknown) => Number(a)) : [];
  const result = gradeQuiz(id, answers);
  if (!result) return NextResponse.json({ error: "not_found" }, { status: 404 });

  // Exam mode: record the attempt (with the client's integrity flags) and
  // WITHHOLD the answer key — an exam taker never sees the correct answers, so
  // they can't be shared. Practice mode is unchanged: the key comes back so the
  // taker can learn from misses.
  if (scoped?.exam) {
    const attempt = recordAttempt({
      quizId: id,
      taker: getViewer().owner,
      score: result.score,
      total: result.total,
      startedAt: Number(body?.startedAt),
      timeLimitSec: scoped.exam.timeLimitSec,
      autoSubmitted: body?.autoSubmitted === true,
      flags: body?.flags,
    });
    return NextResponse.json(
      { score: result.score, total: result.total, exam: true, attemptId: attempt.id, voided: attempt.voided },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}
