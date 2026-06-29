import { NextRequest, NextResponse } from "next/server";

import { recordAudit } from "@/lib/audit";
import { type Card, createDeck, listDecks } from "@/lib/decks";
import { clientIp, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function gated() {
  return process.env.VELLUM_DEMO_MODE !== "1"
    ? NextResponse.json({ error: "dashboard_disabled" }, { status: 404 })
    : null;
}

export async function GET() {
  const off = gated();
  if (off) return off;
  return NextResponse.json({ decks: listDecks() }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest) {
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
  if (cards.length === 0) {
    return NextResponse.json({ error: "no_cards" }, { status: 400 });
  }
  const deck = createDeck(title, cards);
  recordAudit("deck.create", deck.title, clientIp(req));
  return NextResponse.json({ id: deck.id, title: deck.title, cardCount: deck.cards.length });
}
