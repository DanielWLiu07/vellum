import { NextRequest, NextResponse } from "next/server";

import { recordAudit } from "@/lib/audit";
import { duplicateQuiz, getQuiz } from "@/lib/quizzes";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { setShare } from "@/lib/resource-share";
import { DEMO_VIEWER, canView } from "@/lib/visibility";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Google-Docs "Make a copy" for a quiz: anyone who can view it can clone it
// (the copy includes the answer key — the caller now owns the content, the
// same way copying a Google Form copies its key). The copy starts private.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (process.env.VELLUM_DEMO_MODE !== "1") {
    return NextResponse.json({ error: "dashboard_disabled" }, { status: 404 });
  }
  const rl = rateLimit(`copy:${clientIp(req)}`, 10, 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter), "Cache-Control": "no-store" } },
    );
  }
  const { id } = await params;
  const quiz = getQuiz(id);
  if (!quiz) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!canView(quiz, DEMO_VIEWER)) return NextResponse.json({ error: "not_found" }, { status: 404 }); // no existence leak

  const copy = duplicateQuiz(id, DEMO_VIEWER.owner);
  if (!copy) return NextResponse.json({ error: "not_found" }, { status: 404 });
  setShare(copy.id, { visibility: "private", chapter: DEMO_VIEWER.chapter, people: [] });
  recordAudit("quiz.copy", copy.title, clientIp(req));
  return NextResponse.json(
    { id: copy.id, title: copy.title, questionCount: copy.questions.length },
    { headers: { "Cache-Control": "no-store" } },
  );
}
