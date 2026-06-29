import { NextRequest, NextResponse } from "next/server";

import { recordAudit } from "@/lib/audit";
import { deleteDeck, getDeck } from "@/lib/decks";
import { clientIp } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function gated() {
  return process.env.VELLUM_DEMO_MODE !== "1"
    ? NextResponse.json({ error: "dashboard_disabled" }, { status: 404 })
    : null;
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const off = gated();
  if (off) return off;
  const { id } = await params;
  const deck = getDeck(id);
  if (!deck) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ deck }, { headers: { "Cache-Control": "no-store" } });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const off = gated();
  if (off) return off;
  const { id } = await params;
  const deck = getDeck(id);
  if (!deleteDeck(id)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  recordAudit("deck.delete", deck?.title ?? id, clientIp(_req));
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
