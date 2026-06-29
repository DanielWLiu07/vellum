import { NextRequest, NextResponse } from "next/server";

import { recordAudit } from "@/lib/audit";
import { type QuizQuestion, createQuiz, deleteQuiz, listQuizzes } from "@/lib/quizzes";
import { clientIp, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function gated() {
  return process.env.VELLUM_DEMO_MODE !== "1"
    ? NextResponse.json({ error: "dashboard_disabled" }, { status: 404 })
    : null;
}

export async function GET() {
  const off = gated();
  if (off) return off;
  return NextResponse.json({ quizzes: listQuizzes() }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest) {
  const off = gated();
  if (off) return off;
  const rl = rateLimit(`quizzes:${clientIp(req)}`, 20, 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter), "Cache-Control": "no-store" } },
    );
  }
  const body = await req.json().catch(() => null);
  const title = typeof body?.title === "string" ? body.title : "";
  const raw = Array.isArray(body?.questions) ? (body.questions as unknown[]) : [];
  const questions: QuizQuestion[] = raw
    .filter((q): q is Record<string, unknown> => Boolean(q) && typeof q === "object")
    .map((q) => ({
      prompt: String(q.prompt ?? ""),
      choices: Array.isArray(q.choices) ? q.choices.map((c) => String(c ?? "")) : [],
      correctIndex: Number(q.correctIndex ?? 0),
    }));
  const quiz = createQuiz(title, questions);
  if (quiz.questions.length === 0) {
    deleteQuiz(quiz.id); // nothing survived validation; don't leave an empty quiz
    return NextResponse.json({ error: "no_questions" }, { status: 400 });
  }
  recordAudit("quiz.create", quiz.title, clientIp(req));
  return NextResponse.json({ id: quiz.id, title: quiz.title, questionCount: quiz.questions.length });
}
