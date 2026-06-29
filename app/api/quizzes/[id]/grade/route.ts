import { NextRequest, NextResponse } from "next/server";

import { gradeQuiz } from "@/lib/quizzes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Scores submitted answers server-side against the answer key.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (process.env.VELLUM_DEMO_MODE !== "1") {
    return NextResponse.json({ error: "dashboard_disabled" }, { status: 404 });
  }
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const answers = Array.isArray(body?.answers) ? body.answers.map((a: unknown) => Number(a)) : [];
  const result = gradeQuiz(id, answers);
  if (!result) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}
