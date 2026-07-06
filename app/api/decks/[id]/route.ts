import { NextRequest, NextResponse } from "next/server";

import { recordAudit } from "@/lib/audit";
import { type Card, deleteDeck, getDeck, updateDeck } from "@/lib/decks";
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

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const off = gated();
  if (off) return off;
  const { id } = await params;
  const deck = getDeck(id);
  if (!deck) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!canView(deck, DEMO_VIEWER)) return NextResponse.json({ error: "not_found" }, { status: 404 }); // no existence leak
  // canEdit rides along so the UI knows whether to offer Edit/Share controls.
  return NextResponse.json(
    { deck, canEdit: deck.id !== "sample-deck" && canEdit(deck, DEMO_VIEWER) },
    { headers: { "Cache-Control": "no-store" } },
  );
}

// Edit a deck in place (title/cards) and/or update its sharing (visibility,
// chapter, people). Owner or a granted editor only; the sample is immutable.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const off = gated();
  if (off) return off;
  const { id } = await params;
  const deck = getDeck(id);
  if (!deck) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!canView(deck, DEMO_VIEWER)) return NextResponse.json({ error: "not_found" }, { status: 404 }); // no existence leak
  if (id === "sample-deck" || !canEdit(deck, DEMO_VIEWER)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  // Sharing changes (any subset; untouched fields are preserved). Only the
  // owner/admin may change WHO can see a deck — editors edit content only.
  // Check this BEFORE mutating content so a mixed request can't half-apply.
  const share: Parameters<typeof setShare>[1] = {};
  if (body.visibility !== undefined) share.visibility = normalizeVisibility(body.visibility);
  if (typeof body.chapter === "string") share.chapter = body.chapter.trim();
  if (body.people !== undefined) share.people = normalizePeople(body.people, deck.owner);
  const wantsSharing = Object.keys(share).length > 0;
  if (wantsSharing && !canManageSharing(deck, DEMO_VIEWER)) {
    return NextResponse.json({ error: "forbidden_sharing" }, { status: 403 });
  }

  // Content changes.
  const patch: { title?: string; cards?: Card[] } = {};
  if (typeof body.title === "string") patch.title = body.title;
  if (Array.isArray(body.cards)) {
    const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);
    patch.cards = (body.cards as unknown[])
      .filter((c): c is Record<string, unknown> => Boolean(c) && typeof c === "object")
      .map((c) => ({
        front: String(c.front ?? ""),
        back: String(c.back ?? ""),
        frontImageId: str(c.frontImageId),
        backImageId: str(c.backImageId),
      }));
  }
  if (patch.title !== undefined || patch.cards !== undefined) {
    if (!updateDeck(id, patch)) {
      return NextResponse.json({ error: "no_cards" }, { status: 400 });
    }
  }

  if (wantsSharing) setShare(id, share, { visibility: "public", chapter: "" });

  const updated = getDeck(id)!;
  recordAudit("deck.update", updated.title, clientIp(req));
  return NextResponse.json(
    { id: updated.id, title: updated.title, cardCount: updated.cards.length, visibility: updated.visibility, people: updated.people },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const off = gated();
  if (off) return off;
  const { id } = await params;
  const deck = getDeck(id);
  if (!deck) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!canView(deck, DEMO_VIEWER)) return NextResponse.json({ error: "not_found" }, { status: 404 }); // no existence leak
  // Deleting is owner-only (editors can change content, not destroy it).
  if (deck.owner !== DEMO_VIEWER.owner && !DEMO_VIEWER.admin) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (!deleteDeck(id)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  deleteShare(id); // drop sidecar entries so they don't accumulate as orphans
  recordAudit("deck.delete", deck.title, clientIp(_req));
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
