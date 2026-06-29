import { NextRequest, NextResponse } from "next/server";

import { deleteDeck, getDeck } from "@/lib/decks";

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
  if (!deleteDeck(id)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
