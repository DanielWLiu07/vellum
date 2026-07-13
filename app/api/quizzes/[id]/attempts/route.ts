import { NextRequest, NextResponse } from "next/server";
import { enterRequest } from "@/lib/auth";

import { getAttempt, listAttempts, unvoidAttempt, voidAttempt } from "@/lib/quiz-attempts";
import { getQuiz } from "@/lib/quizzes";
import { getViewer } from "@/lib/profile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function gated() {
  return process.env.VELLUM_DEMO_MODE !== "1"
    ? NextResponse.json({ error: "dashboard_disabled" }, { status: 404 })
    : null;
}

// Only the quiz owner or an admin may review exam attempts (they carry other
// members' scores + integrity timelines). Returns 404 for a missing quiz, and
// the same 404 for a viewer who can't manage it, to avoid an existence leak.
function manageGate(id: string): { ok: true } | { ok: false; res: NextResponse } {
  const quiz = getQuiz(id);
  if (!quiz) return { ok: false, res: NextResponse.json({ error: "not_found" }, { status: 404 }) };
  const viewer = getViewer();
  if (quiz.owner !== viewer.owner && !viewer.admin) {
    return { ok: false, res: NextResponse.json({ error: "not_found" }, { status: 404 }) };
  }
  return { ok: true };
}

/** List every exam attempt for this quiz (owner/admin only). */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await enterRequest(req);
  const off = gated();
  if (off) return off;
  const { id } = await params;
  const gate = manageGate(id);
  if (!gate.ok) return gate.res;
  return NextResponse.json({ attempts: listAttempts(id) }, { headers: { "Cache-Control": "no-store" } });
}

/** Void or reinstate one attempt (owner/admin override of the auto-void). */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await enterRequest(req);
  const off = gated();
  if (off) return off;
  const { id } = await params;
  const gate = manageGate(id);
  if (!gate.ok) return gate.res;

  const body = await req.json().catch(() => null);
  const attemptId = typeof body?.attemptId === "string" ? body.attemptId : "";
  const attempt = getAttempt(attemptId);
  // The attempt must belong to THIS quiz - stops voiding another quiz's attempt
  // by passing a foreign id to a quiz you happen to own.
  if (!attempt || attempt.quizId !== id) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const updated =
    body?.void === false
      ? unvoidAttempt(attemptId)
      : voidAttempt(attemptId, typeof body?.reason === "string" ? body.reason : "Voided by reviewer");
  return NextResponse.json({ attempt: updated }, { headers: { "Cache-Control": "no-store" } });
}
