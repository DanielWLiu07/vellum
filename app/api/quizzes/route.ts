import { NextRequest, NextResponse } from "next/server";
import { enterRequest } from "@/lib/auth";

import { recordAudit } from "@/lib/audit";
import { flaggedReason, moderateText } from "@/lib/moderation";
import { type QuizQuestion, coerceChoice, createQuiz, listQuizzes } from "@/lib/quizzes";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { getViewer } from "@/lib/profile";
import { setShare } from "@/lib/resource-share";
import { canView, normalizeVisibility } from "@/lib/visibility";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function gated() {
  return process.env.VELLUM_DEMO_MODE !== "1"
    ? NextResponse.json({ error: "dashboard_disabled" }, { status: 404 })
    : null;
}

export async function GET(req: NextRequest) {
  await enterRequest(req);
  const off = gated();
  if (off) return off;
  // Scoped to what the viewer may see, like /api/docs — private quizzes and
  // other-chapter quizzes are not leaked into the shared list.
  const quizzes = listQuizzes().filter((q) => canView(q, getViewer()));
  return NextResponse.json({ quizzes }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest) {
  await enterRequest(req);
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
      choices: Array.isArray(q.choices) ? q.choices.map(coerceChoice) : [],
      correctIndex: Number(q.correctIndex ?? 0),
      ...(typeof q.promptImageId === "string" && q.promptImageId ? { promptImageId: q.promptImageId } : {}),
    }));
  // AI moderation over the title + every prompt and choice text; no-ops without a key.
  const mod = await moderateText(
    [title, ...questions.flatMap((q) => [q.prompt, ...q.choices.map((c) => c.text)])].filter(Boolean).join("\n"),
  );
  if (!mod.allowed) {
    recordAudit("quiz.blocked", title || "Untitled quiz", flaggedReason(mod));
    return NextResponse.json({ error: "content_flagged", categories: mod.categories }, { status: 422 });
  }
  // A quiz can be created empty - a draft you fill in from its live editor.
  const quiz = createQuiz(title, questions, getViewer().owner, body?.exam);
  // Optional visibility chosen on the create screen (drafts default to private).
  if (typeof body?.visibility === "string") {
    setShare(quiz.id, { visibility: normalizeVisibility(body.visibility), chapter: getViewer().chapter });
  }
  recordAudit("quiz.create", quiz.title);
  return NextResponse.json({ id: quiz.id, title: quiz.title, questionCount: quiz.questions.length });
}
