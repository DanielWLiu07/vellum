import { NextRequest, NextResponse } from "next/server";
import { enterRequest } from "@/lib/auth";

import { getQuiz, getQuizAnswerKey } from "@/lib/quizzes";
import { getViewer } from "@/lib/profile";
import { canView } from "@/lib/visibility";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The answer key for a quiz: questions + the correct index of each. Powers the
 * optional "reveal answers as you go" study mode and the answer sheet. Gated on
 * canView like grading - these are study quizzes, and revealing the key is an
 * opt-in study aid, not an exam bypass (real graded exams live in the HOSA
 * platform). A private quiz's key is never served to someone who can't view it.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await enterRequest(req);
  if (process.env.VELLUM_DEMO_MODE !== "1") {
    return NextResponse.json({ error: "dashboard_disabled" }, { status: 404 });
  }
  const { id } = await params;
  const scoped = getQuiz(id);
  if (!scoped) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const viewer = getViewer();
  if (!canView(scoped, viewer)) return NextResponse.json({ error: "not_found" }, { status: 404 }); // no existence leak

  // Exam mode: the answer key is NOT a study aid. Only the quiz owner (or an
  // admin) may read it - a taker must never see the correct answers, before or
  // after submitting, so they can't be leaked or shared.
  if (scoped.exam && scoped.owner !== viewer.owner && !viewer.admin) {
    return NextResponse.json({ error: "exam_locked" }, { status: 403 });
  }

  const key = getQuizAnswerKey(id);
  if (!key) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json(key, { headers: { "Cache-Control": "no-store" } });
}
