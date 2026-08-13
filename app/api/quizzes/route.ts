import { NextRequest, NextResponse } from "next/server";
import { enterRequest } from "@/lib/auth";

import { recordAudit } from "@/lib/audit";
import { flaggedReason, moderateText } from "@/lib/moderation";
import { enqueue } from "@/lib/moderation-queue";
import { resolvePublish } from "@/lib/publish";
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
  // Scope every new quiz EXPLICITLY, including when the caller named no
  // visibility. Without a share row lib/quizzes composes in its own fallback,
  // `public`, so a create that simply left the field out reached every member
  // in the country without passing the gate below — the whole rule skipped by
  // omitting one word. An unscoped quiz is private, the way an upload is; it
  // reaches an audience by asking.
  const requested = typeof body?.visibility === "string" ? normalizeVisibility(body.visibility) : "private";
  // Public is a submission, not a setting - the same rule documents follow (see
  // lib/publish). `current` is private because the quiz is seconds old: there is
  // no audience yet for the hold to take away, so waiting costs nothing.
  const { visibility, submitted } = resolvePublish({
    requested,
    current: "private",
    isAdmin: getViewer().admin,
  });
  const share = setShare(quiz.id, { visibility, chapter: getViewer().chapter });
  if (submitted) {
    enqueue({
      resourceId: quiz.id,
      kind: "quiz",
      owner: quiz.owner,
      title: quiz.title,
      reason: "submitted",
      requestedVisibility: "public",
    });
    recordAudit("quiz.submitted", quiz.title);
  }
  recordAudit("quiz.create", quiz.title);
  return NextResponse.json({
    id: quiz.id,
    title: quiz.title,
    questionCount: quiz.questions.length,
    // What the quiz is actually scoped to, which is not always what was asked
    // for: the create screen otherwise has only its own dropdown to go on.
    visibility: share.visibility,
    ...(submitted ? { submittedForReview: true } : {}),
  });
}
