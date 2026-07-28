import { NextRequest, NextResponse } from "next/server";
import { enterRequest } from "@/lib/auth";

import { recordAttempt } from "@/lib/quiz-attempts";
import { getQuiz, gradeQuiz } from "@/lib/quizzes";
import { getViewer } from "@/lib/profile";
import { canView } from "@/lib/visibility";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Scores submitted answers server-side against the answer key.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await enterRequest(req);
  if (process.env.VELLUM_DEMO_MODE !== "1") {
    return NextResponse.json({ error: "dashboard_disabled" }, { status: 404 });
  }
  const { id } = await params;
  // Same access gate as reading the quiz — grading returns the answer key,
  // so a private quiz must not be gradeable by someone who can't view it.
  const scoped = getQuiz(id);
  if (scoped && !canView(scoped, getViewer())) {
    return NextResponse.json({ error: "not_found" }, { status: 404 }); // no existence leak
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
