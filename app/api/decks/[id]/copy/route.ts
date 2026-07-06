import { NextRequest, NextResponse } from "next/server";

import { recordAudit } from "@/lib/audit";
import { duplicateDeck, getDeck } from "@/lib/decks";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { setShare } from "@/lib/resource-share";
import { DEMO_VIEWER, canView } from "@/lib/visibility";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Google-Docs "Make a copy" for a deck: anyone who can view it can clone it.
// The copy belongs to the caller and starts private.
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
  const deck = getDeck(id);
  if (!deck) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!canView(deck, DEMO_VIEWER)) return NextResponse.json({ error: "not_found" }, { status: 404 }); // no existence leak

  const copy = duplicateDeck(id, DEMO_VIEWER.owner);
  if (!copy) return NextResponse.json({ error: "not_found" }, { status: 404 });
  setShare(copy.id, { visibility: "private", chapter: DEMO_VIEWER.chapter, people: [] });
  recordAudit("deck.copy", copy.title, clientIp(req));
  return NextResponse.json(
    { id: copy.id, title: copy.title, cardCount: copy.cards.length },
    { headers: { "Cache-Control": "no-store" } },
  );
}
