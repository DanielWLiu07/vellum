import { NextRequest, NextResponse } from "next/server";

import { getQuiz, gradeQuiz } from "@/lib/quizzes";
import { DEMO_VIEWER, canView } from "@/lib/visibility";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Scores submitted answers server-side against the answer key.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (process.env.VELLUM_DEMO_MODE !== "1") {
    return NextResponse.json({ error: "dashboard_disabled" }, { status: 404 });
  }
  const { id } = await params;
  // Same access gate as reading the quiz — grading returns the answer key,
  // so a private quiz must not be gradeable by someone who can't view it.
  const scoped = getQuiz(id);
  if (scoped && !canView(scoped, DEMO_VIEWER)) {
    return NextResponse.json({ error: "not_found" }, { status: 404 }); // no existence leak
  }
  const body = await req.json().catch(() => null);
  const answers = Array.isArray(body?.answers) ? body.answers.map((a: unknown) => Number(a)) : [];
  const result = gradeQuiz(id, answers);
  if (!result) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}
