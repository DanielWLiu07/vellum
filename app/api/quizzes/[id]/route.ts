import { NextRequest, NextResponse } from "next/server";

import { recordAudit } from "@/lib/audit";
import { type QuizQuestion, deleteQuiz, getQuiz, getQuizForTaker, updateQuiz } from "@/lib/quizzes";
import { clientIp } from "@/lib/rate-limit";
import { deleteShare, setShare } from "@/lib/resource-share";
import { DEMO_VIEWER, canEdit, canManageSharing, canView, normalizePeople, normalizeVisibility } from "@/lib/visibility";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function gated() {
  return process.env.VELLUM_DEMO_MODE !== "1"
    ? NextResponse.json({ error: "dashboard_disabled" }, { status: 404 })
    : null;
}

// Returns the quiz WITHOUT the correct answers (those stay server-side).
// `?edit=1` returns the full quiz including the answer key — but only for
// someone allowed to edit it; a taker can never pull the key this way.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const off = gated();
  if (off) return off;
  const { id } = await params;
  const scoped = getQuiz(id);
  if (!scoped) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!canView(scoped, DEMO_VIEWER)) return NextResponse.json({ error: "not_found" }, { status: 404 }); // no existence leak

  const editable = scoped.id !== "sample-quiz" && canEdit(scoped, DEMO_VIEWER);
  if (req.nextUrl.searchParams.get("edit") === "1") {
    if (!editable) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    return NextResponse.json({ quiz: scoped, canEdit: true }, { headers: { "Cache-Control": "no-store" } });
  }
  const quiz = getQuizForTaker(id)!;
  return NextResponse.json({ quiz, canEdit: editable }, { headers: { "Cache-Control": "no-store" } });
}

// Edit a quiz in place (title/questions) and/or update its sharing
// (visibility, chapter, people). Owner or a granted editor only; the sample
// is immutable.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const off = gated();
  if (off) return off;
  const { id } = await params;
  const quiz = getQuiz(id);
  if (!quiz) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!canView(quiz, DEMO_VIEWER)) return NextResponse.json({ error: "not_found" }, { status: 404 }); // no existence leak
  if (id === "sample-quiz" || !canEdit(quiz, DEMO_VIEWER)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  // Sharing changes (any subset; untouched fields are preserved). Only the
  // owner/admin may change WHO can see a quiz — editors edit content only.
  // Check this BEFORE mutating content so a mixed request can't half-apply.
  const share: Parameters<typeof setShare>[1] = {};
  if (body.visibility !== undefined) share.visibility = normalizeVisibility(body.visibility);
  if (typeof body.chapter === "string") share.chapter = body.chapter.trim();
  if (body.people !== undefined) share.people = normalizePeople(body.people, quiz.owner);
  const wantsSharing = Object.keys(share).length > 0;
  if (wantsSharing && !canManageSharing(quiz, DEMO_VIEWER)) {
    return NextResponse.json({ error: "forbidden_sharing" }, { status: 403 });
  }

  // Content changes.
  const patch: { title?: string; questions?: QuizQuestion[] } = {};
  if (typeof body.title === "string") patch.title = body.title;
  if (Array.isArray(body.questions)) {
    patch.questions = (body.questions as unknown[])
      .filter((q): q is Record<string, unknown> => Boolean(q) && typeof q === "object")
      .map((q) => ({
        prompt: String(q.prompt ?? ""),
        choices: Array.isArray(q.choices) ? q.choices.map((c) => String(c ?? "")) : [],
        correctIndex: Number(q.correctIndex ?? 0),
      }));
  }
  if (patch.title !== undefined || patch.questions !== undefined) {
    if (!updateQuiz(id, patch)) {
      return NextResponse.json({ error: "no_questions" }, { status: 400 });
    }
  }

  if (wantsSharing) setShare(id, share, { visibility: "public", chapter: "" });

  const updated = getQuiz(id)!;
  recordAudit("quiz.update", updated.title, clientIp(req));
  return NextResponse.json(
    { id: updated.id, title: updated.title, questionCount: updated.questions.length, visibility: updated.visibility, people: updated.people },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const off = gated();
  if (off) return off;
  const { id } = await params;
  const quiz = getQuiz(id);
  if (!quiz) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!canView(quiz, DEMO_VIEWER)) return NextResponse.json({ error: "not_found" }, { status: 404 }); // no existence leak
  // Deleting is owner-only (editors can change content, not destroy it).
  if (quiz.owner !== DEMO_VIEWER.owner && !DEMO_VIEWER.admin) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (!deleteQuiz(id)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  deleteShare(id); // drop sidecar entries so they don't accumulate as orphans
  recordAudit("quiz.delete", quiz.title, clientIp(_req));
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
