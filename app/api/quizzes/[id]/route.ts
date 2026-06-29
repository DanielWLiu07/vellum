import { NextRequest, NextResponse } from "next/server";

import { recordAudit } from "@/lib/audit";
import { deleteQuiz, getQuiz, getQuizForTaker } from "@/lib/quizzes";
import { clientIp } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function gated() {
  return process.env.VELLUM_DEMO_MODE !== "1"
    ? NextResponse.json({ error: "dashboard_disabled" }, { status: 404 })
    : null;
}

// Returns the quiz WITHOUT the correct answers (those stay server-side).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const off = gated();
  if (off) return off;
  const { id } = await params;
  const quiz = getQuizForTaker(id);
  if (!quiz) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ quiz }, { headers: { "Cache-Control": "no-store" } });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const off = gated();
  if (off) return off;
  const { id } = await params;
  const quiz = getQuiz(id);
  if (!deleteQuiz(id)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  recordAudit("quiz.delete", quiz?.title ?? id, clientIp(_req));
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
