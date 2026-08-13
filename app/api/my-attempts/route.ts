import { NextRequest, NextResponse } from "next/server";
import { enterRequest } from "@/lib/auth";

import { myQuizHistory } from "@/lib/quiz-attempts";
import { getViewer } from "@/lib/profile";
import { getQuiz } from "@/lib/quizzes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The signed-in member's own exam results, grouped by quiz.
 *
 * A sibling of /api/quizzes/[id]/attempts rather than a loosening of it. That
 * route answers "every score on this quiz" and is right to stay owner/admin
 * only - it carries other members' results and their integrity timelines. The
 * side effect was that the person who sat the exam was the one party who could
 * not see what they got. This answers the other question, "every score of
 * mine", which needs no gate because the answer is already yours.
 *
 * There is deliberately NO ?owner= parameter. The signed session decides whose
 * history comes back; a parameter would be an authorization hole wearing a
 * filter's clothes, and "just for admins" is how one gets added.
 */
export async function GET(req: NextRequest) {
  await enterRequest(req);
  if (process.env.VELLUM_DEMO_MODE !== "1") {
    return NextResponse.json({ error: "dashboard_disabled" }, { status: 404 });
  }
  // A signed-out viewer is owner "" and gets an empty history rather than an
  // error: fail closed, and there is genuinely nothing of theirs to report.
  //
  // The title lookup ignores the quiz's current visibility on purpose. It is a
  // title this member has already been shown - they sat the exam - so a later
  // rescope shouldn't retroactively turn their own result into an unreadable
  // row. Nothing else about the quiz is read.
  const quizzes = myQuizHistory(getViewer().owner, (id) => getQuiz(id)?.title);
  return NextResponse.json({ quizzes }, { headers: { "Cache-Control": "no-store" } });
}
