import { NextRequest, NextResponse } from "next/server";
import { enterRequest } from "@/lib/auth";

import { recordAudit } from "@/lib/audit";
import { type Card, createDeck, listDecks } from "@/lib/decks";
import { flaggedReason, moderateText } from "@/lib/moderation";
import { enqueue } from "@/lib/moderation-queue";
import { resolvePublish } from "@/lib/publish";
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
  // Scoped to what the viewer may see, like /api/docs — private decks and
  // other-chapter decks are not leaked into the shared list.
  const decks = listDecks().filter((d) => canView(d, getViewer()));
  return NextResponse.json({ decks }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest) {
  await enterRequest(req);
  const off = gated();
  if (off) return off;
  const rl = rateLimit(`decks:${clientIp(req)}`, 20, 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter), "Cache-Control": "no-store" } },
    );
  }
  const body = await req.json().catch(() => null);
  const title = typeof body?.title === "string" ? body.title : "";
  const raw = Array.isArray(body?.cards) ? (body.cards as unknown[]) : [];
  const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);
  const cards: Card[] = raw
    .filter((c): c is Record<string, unknown> => Boolean(c) && typeof c === "object")
    .map((c) => ({
      front: String(c.front ?? ""),
      back: String(c.back ?? ""),
      frontImageId: str(c.frontImageId),
      backImageId: str(c.backImageId),
    }))
    .filter((c) => c.front || c.back || c.frontImageId || c.backImageId);
  // A deck can be created empty - a draft you fill in from its live editor.
  // AI moderation: refuse obviously harmful content before it is stored. Runs
  // over the title + every card face; no-ops when OPENAI_API_KEY is unset.
  const mod = await moderateText(
    [title, ...cards.flatMap((c) => [c.front, c.back])].filter(Boolean).join("\n"),
  );
  if (!mod.allowed) {
    recordAudit("deck.blocked", title || "Untitled deck", flaggedReason(mod));
    return NextResponse.json({ error: "content_flagged", categories: mod.categories }, { status: 422 });
  }
  const deck = createDeck(title, cards, getViewer().owner);
  // Scope every new deck EXPLICITLY, including when the caller named no
  // visibility. Without a share row lib/decks composes in its own fallback,
  // `public`, so a create that simply left the field out reached every member
  // in the country without passing the gate below — the whole rule skipped by
  // omitting one word. An unscoped deck is private, the way an upload is; it
  // reaches an audience by asking.
  const requested = typeof body?.visibility === "string" ? normalizeVisibility(body.visibility) : "private";
  // Public is a submission, not a setting - the same rule documents follow (see
  // lib/publish). `current` is private because the deck is seconds old: there is
  // no audience yet for the hold to take away, so waiting costs nothing.
  const { visibility, submitted } = resolvePublish({
    requested,
    current: "private",
    isAdmin: getViewer().admin,
  });
  const share = setShare(deck.id, { visibility, chapter: getViewer().chapter });
  if (submitted) {
    enqueue({
      resourceId: deck.id,
      kind: "deck",
      owner: deck.owner,
      title: deck.title,
      reason: "submitted",
      requestedVisibility: "public",
    });
    recordAudit("deck.submitted", deck.title);
  }
  recordAudit("deck.create", deck.title);
  return NextResponse.json({
    id: deck.id,
    title: deck.title,
    cardCount: deck.cards.length,
    // What the deck is actually scoped to, which is not always what was asked
    // for: the create screen otherwise has only its own dropdown to go on.
    visibility: share.visibility,
    ...(submitted ? { submittedForReview: true } : {}),
  });
}
