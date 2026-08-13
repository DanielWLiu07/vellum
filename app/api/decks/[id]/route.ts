import { NextRequest, NextResponse } from "next/server";
import { enterRequest } from "@/lib/auth";

import { recordAudit } from "@/lib/audit";
import { type Card, deleteDeck, getDeck, updateDeck } from "@/lib/decks";
import { flaggedReason, moderateText } from "@/lib/moderation";
import { deleteQueueFor, describeOpenReview, enqueue, isQuarantined } from "@/lib/moderation-queue";
import { resolvePublish } from "@/lib/publish";
import { deleteShare, setShare } from "@/lib/resource-share";
import { deleteFavoritesFor } from "@/lib/favorites";
import { getViewer } from "@/lib/profile";
import { canEdit, canManageSharing, canView, normalizePeople, normalizeVisibility } from "@/lib/visibility";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function gated() {
  return process.env.VELLUM_DEMO_MODE !== "1"
    ? NextResponse.json({ error: "dashboard_disabled" }, { status: 404 })
    : null;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await enterRequest(req);
  const off = gated();
  if (off) return off;
  const { id } = await params;
  const deck = getDeck(id);
  if (!deck) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!canView(deck, getViewer())) return NextResponse.json({ error: "not_found" }, { status: 404 }); // no existence leak
  // canEdit rides along so the UI knows whether to offer Edit/Share controls.
  return NextResponse.json(
    { deck, canEdit: deck.id !== "sample-deck" && canEdit(deck, getViewer()) },
    { headers: { "Cache-Control": "no-store" } },
  );
}

// Edit a deck in place (title/cards) and/or update its sharing (visibility,
// chapter, people). Owner or a granted editor only; the sample is immutable.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await enterRequest(req);
  const off = gated();
  if (off) return off;
  const { id } = await params;
  const deck = getDeck(id);
  if (!deck) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!canView(deck, getViewer())) return NextResponse.json({ error: "not_found" }, { status: 404 }); // no existence leak
  if (id === "sample-deck" || !canEdit(deck, getViewer())) {
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
  if (wantsSharing && !canManageSharing(deck, getViewer())) {
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
    // Moderate edits too, not just creates - otherwise a benign deck could be
    // edited into harmful content, bypassing the create-time check.
    const mod = await moderateText(
      [patch.title ?? deck.title, ...(patch.cards ?? []).flatMap((c) => [c.front, c.back])]
        .filter(Boolean)
        .join("\n"),
    );
    if (!mod.allowed) {
      recordAudit("deck.blocked", (patch.title ?? deck.title) || "Untitled deck", flaggedReason(mod));
      return NextResponse.json({ error: "content_flagged", categories: mod.categories }, { status: 422 });
    }
    if (!updateDeck(id, patch)) {
      return NextResponse.json({ error: "no_cards" }, { status: 400 });
    }
  }

  // Going public is a submission, not a setting: it puts the deck in front of
  // every HOSA member in the country, which is the same exposure a document
  // carries and gets the same answer. Chapter and private stay the owner's own
  // call, and an admin publishes directly - see lib/publish for where the line
  // sits. Captured before the decision rewrites it, so a clamp can be compared
  // against what the owner actually asked for.
  const requestedVisibility = share.visibility;
  let submitted = false;
  // Read the hold BEFORE anything is enqueued. A pending submission counts as a
  // hold, so queuing first would make the clamp below force this very deck to
  // private - charging the owner the audience they already had as the price of
  // asking about a wider one, which is the outcome lib/publish exists to avoid.
  const heldForReview = isQuarantined(id);
  if (share.visibility !== undefined) {
    const decision = resolvePublish({
      requested: share.visibility,
      current: deck.visibility,
      isAdmin: getViewer().admin,
    });
    share.visibility = decision.visibility;
    submitted = decision.submitted;
  }

  // Seed the defaults from the deck's CURRENT scope. The literal that used to
  // sit here restated lib/decks' own fallback for a deck with no share row, so
  // the two could only ever drift apart - and every drift would be a people-only
  // update handing the deck to an audience nobody asked for.
  if (wantsSharing) setShare(id, share, { visibility: deck.visibility, chapter: deck.chapter });

  const updated = getDeck(id)!;
  if (submitted && !heldForReview) {
    enqueue({
      resourceId: id,
      kind: "deck",
      owner: deck.owner,
      title: updated.title,
      reason: "submitted",
      requestedVisibility: "public",
    });
    recordAudit("deck.submitted", updated.title);
  }
  recordAudit("deck.update", updated.title);
  return NextResponse.json(
    {
      id: updated.id,
      title: updated.title,
      cardCount: updated.cards.length,
      visibility: updated.visibility,
      people: updated.people,
      // Held at a narrower scope pending review - say so, or the share dialog
      // reports the save it asked for and shows the old scope on refresh.
      ...(submitted ? { submittedForReview: true } : {}),
      // A scope refused outright rather than queued: a held deck, or an owner
      // banned from public sharing. Reporting {ok} without this is how "I
      // clicked Share and nothing moved" became a bug with no explanation
      // anywhere.
      ...(!submitted && requestedVisibility !== undefined && updated.visibility !== requestedVisibility
        ? {
            clamped: true,
            clampedTo: updated.visibility,
            clampedReason: heldForReview ? "held_for_review" : "sharing_restricted",
          }
        : {}),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await enterRequest(req);
  const off = gated();
  if (off) return off;
  const { id } = await params;
  const deck = getDeck(id);
  if (!deck) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!canView(deck, getViewer())) return NextResponse.json({ error: "not_found" }, { status: 404 }); // no existence leak
  // Deleting is owner-only (editors can change content, not destroy it).
  if (deck.owner !== getViewer().owner && !getViewer().admin) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (!deleteDeck(id)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  deleteShare(id); // drop sidecar entries so they don't accumulate as orphans
  deleteFavoritesFor(id);
  recordAudit("deck.delete", deck.title);
  // Same cleanup and the same second line as the document path: without this
  // the entry outlives the deck, and isQuarantined stays true for its id
  // forever. See deleteQueueFor for why the delete is allowed but not silent.
  const openReview = deleteQueueFor(id);
  if (openReview.length > 0) {
    recordAudit("moderation.deleted_under_review", deck.title, describeOpenReview(openReview));
  }
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
