import { NextRequest, NextResponse } from "next/server";
import { enterRequest } from "@/lib/auth";

import { recordAudit } from "@/lib/audit";
import { type Card, createDeck, listDecks } from "@/lib/decks";
import { flaggedReason, moderateText } from "@/lib/moderation";
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
  // Optional visibility chosen on the create screen (drafts default to private).
  if (typeof body?.visibility === "string") {
    setShare(deck.id, { visibility: normalizeVisibility(body.visibility), chapter: getViewer().chapter });
  }
  recordAudit("deck.create", deck.title);
  return NextResponse.json({ id: deck.id, title: deck.title, cardCount: deck.cards.length });
}
