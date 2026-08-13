/**
 * A member's own study activity: record one fact, or read back the transcript.
 *
 * Deliberately mirrors /api/my-attempts rather than the admin surfaces. There
 * is no gate on reading, because the answer is already yours — the question
 * "what have I studied" cannot leak anything the asker didn't do. What there
 * is instead is one hard rule, the same one my-attempts states: the SIGNED
 * SESSION decides whose activity this is, and there is no `?member=`
 * parameter. A filter that selects a person is an authorization hole with a
 * filter's manners, and "just for advisors" is how one gets added later.
 */

import { NextRequest, NextResponse } from "next/server";

import { enterRequest } from "@/lib/auth";
import { ensureReady } from "@/lib/bootstrap";
import { getDeck } from "@/lib/decks";
import { getModule } from "@/lib/modules";
import { getViewer } from "@/lib/profile";
import { getQuiz } from "@/lib/quizzes";
import { getDoc } from "@/lib/store";
import { recordStudy, transcript, type StudyKind } from "@/lib/study-activity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The live title for a piece of content, or undefined if it is gone.
 *
 * Resolved SERVER-SIDE and never taken from the request body. A client-supplied
 * title would let one member write arbitrary text into a record the transcript
 * then renders — and the store keeps a snapshot precisely so a record survives
 * its content being renamed or deleted, which only works if the snapshot was
 * trustworthy when it was taken.
 */
async function titleOf(kind: StudyKind, refId: string): Promise<string | undefined> {
  if (kind === "doc") return (await getDoc(refId))?.name;
  if (kind === "deck") return getDeck(refId)?.title;
  if (kind === "quiz") return getQuiz(refId)?.title;
  return getModule(refId)?.title;
}

/** Record one study fact for the signed-in member. */
export async function POST(req: NextRequest) {
  await enterRequest(req);
  await ensureReady();
  const member = getViewer().owner;
  // Signed out records nothing. recordStudy refuses a blank member anyway —
  // this is the same refusal said earlier, with a status a caller can read.
  if (!member) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const kind = body.kind;
  const refId = typeof body.refId === "string" ? body.refId : "";
  // Resolve the title before recording, and only for a kind the store accepts.
  const title =
    kind === "doc" || kind === "deck" || kind === "quiz" || kind === "module"
      ? await titleOf(kind, refId)
      : undefined;

  const event = recordStudy({
    member,
    kind,
    refId,
    part: body.part,
    action: body.action,
    grade: body.grade,
    title,
  });
  // Null means the input didn't describe a study fact — unknown kind or
  // action, blank ref. A 400 rather than a silent 200: the caller asked us to
  // remember something and we didn't.
  if (!event) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  return NextResponse.json({ event }, { headers: { "Cache-Control": "no-store" } });
}

/** Everything this member has studied, newest first. */
export async function GET(req: NextRequest) {
  await enterRequest(req);
  await ensureReady();
  const member = getViewer().owner;
  // An empty transcript rather than a 401: a signed-out viewer genuinely has
  // no study activity, and that is the honest answer to the question.
  if (!member) {
    return NextResponse.json({ entries: [] }, { headers: { "Cache-Control": "no-store" } });
  }

  // transcript() takes a synchronous resolver, and only `doc` lookups are
  // async, so the doc titles are gathered first and the resolver reads from
  // that map. Recomputing per entry would also mean one store hit per row.
  const rough = transcript(member);
  const docTitles = new Map<string, string>();
  await Promise.all(
    rough
      .filter((e) => e.kind === "doc")
      .map(async (e) => {
        const name = (await getDoc(e.refId))?.name;
        if (name) docTitles.set(e.refId, name);
      }),
  );

  const entries = transcript(member, (kind, refId) => {
    if (kind === "doc") return docTitles.get(refId);
    if (kind === "deck") return getDeck(refId)?.title;
    if (kind === "quiz") return getQuiz(refId)?.title;
    return getModule(refId)?.title;
  });

  return NextResponse.json({ entries }, { headers: { "Cache-Control": "no-store" } });
}
