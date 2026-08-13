/**
 * One piece of content's study state for the signed-in member.
 *
 * A sibling of /api/study rather than a change to it. That route answers "what
 * have I studied" across everything, and its TranscriptEntry is an aggregate -
 * three subsections read, twelve reviews. A player cannot be built from an
 * aggregate: the module needs to know WHICH subsections are ticked to redraw
 * the checkmarks, and the deck needs per-card scheduling to decide what to ask
 * next. Those are the two reads the UI actually makes, so they live together.
 *
 * Same hard rule as /api/study and /api/my-attempts: the SIGNED SESSION decides
 * whose state this is. No `?member=`.
 */

import { NextRequest, NextResponse } from "next/server";

import { enterRequest } from "@/lib/auth";
import { ensureReady } from "@/lib/bootstrap";
import { getDeck } from "@/lib/decks";
import { getModule } from "@/lib/modules";
import { getViewer } from "@/lib/profile";
import { clearCompletion, deckSchedule, moduleProgress } from "@/lib/study-activity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Every subsection id in a module, in the order the player walks them. */
function subsectionIds(moduleId: string): string[] | null {
  const mod = getModule(moduleId);
  if (!mod) return null;
  return mod.sections.flatMap((s) => (s.subsections ?? []).map((ss) => ss.id));
}

/**
 * GET ?kind=module&refId=… -> { progress }
 * GET ?kind=deck&refId=…   -> { schedule }
 *
 * Signed out returns empty state rather than 401. The player renders its
 * content either way, and an error here would only tempt a caller into
 * treating a failed progress read as a failed page.
 */
export async function GET(req: NextRequest) {
  await enterRequest(req);
  await ensureReady();
  const member = getViewer().owner;
  const params = req.nextUrl.searchParams;
  const kind = params.get("kind");
  const refId = params.get("refId") ?? "";

  if (kind === "module") {
    const ids = subsectionIds(refId);
    if (!ids) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json(
      { progress: moduleProgress(member, refId, ids) },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  if (kind === "deck") {
    const deck = getDeck(refId);
    if (!deck) return NextResponse.json({ error: "not_found" }, { status: 404 });
    // The clock is read here, once, so every card in the response is judged
    // due against the same instant.
    return NextResponse.json(
      { schedule: deckSchedule(member, refId, deck.cards, Date.now()) },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  return NextResponse.json({ error: "bad_request" }, { status: 400 });
}

/**
 * Un-complete one part - the module player's "mark not done" toggle.
 *
 * DELETE rather than a POST with a "not done" action: the store says not-done
 * by the ABSENCE of a row, and a second way to say it would be a second thing
 * to keep in agreement. Only completions are clearable; a view or a review is
 * something that happened, and letting a member erase those would make the
 * transcript a claim rather than a record.
 */
export async function DELETE(req: NextRequest) {
  await enterRequest(req);
  await ensureReady();
  const member = getViewer().owner;
  if (!member) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const kind = body?.kind;
  if (kind !== "module" && kind !== "deck" && kind !== "quiz" && kind !== "doc") {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  const refId = typeof body?.refId === "string" ? body.refId : "";
  const part = typeof body?.part === "string" ? body.part : undefined;
  if (!refId) return NextResponse.json({ error: "bad_request" }, { status: 400 });

  return NextResponse.json(
    { cleared: clearCompletion(member, kind, refId, part) },
    { headers: { "Cache-Control": "no-store" } },
  );
}
