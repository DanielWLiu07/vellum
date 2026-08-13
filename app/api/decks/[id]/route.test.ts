import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";

import { PATCH } from "./route";
import { createDeck, deleteDeck, getDeck } from "@/lib/decks";
import { __resetModerationQueue, listPending } from "@/lib/moderation-queue";
import { OWNER_KEY } from "@/lib/profile-types";
import { setShare } from "@/lib/resource-share";
import { __resetShareBans, banPublicSharing } from "@/lib/share-ban";

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const patch = (id: string, body: unknown) =>
  PATCH(
    new NextRequest(`https://vellum.test/api/decks/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    ctx(id),
  );

beforeEach(() => {
  process.env.VELLUM_DEMO_MODE = "1";
});
afterEach(() => {
  delete process.env.VELLUM_DEMO_MODE;
});

// The demo viewer is owner "you". These tests seed a deck owned by someone
// ELSE with "you" granted the editor role, to prove the least-privilege split:
// an editor may change content but NOT sharing.
describe("PATCH /api/decks/[id] — editor cannot manage sharing", () => {
  it("lets a granted editor change content (200) but rejects a sharing change (403)", async () => {
    const deck = createDeck("Ally's deck", [{ front: "a", back: "b" }], "ally");
    setShare(deck.id, { visibility: "private", people: [{ person: "you", role: "editor" }] });
    try {
      // Content edit: allowed.
      const contentRes = await patch(deck.id, { title: "Edited by editor" });
      expect(contentRes.status).toBe(200);
      expect(getDeck(deck.id)!.title).toBe("Edited by editor");

      // Sharing change (flip to public): forbidden for a non-owner editor.
      const shareRes = await patch(deck.id, { visibility: "public" });
      expect(shareRes.status).toBe(403);
      expect((await shareRes.json()).error).toBe("forbidden_sharing");
      // The deck stayed private — the escalation attempt changed nothing.
      expect(getDeck(deck.id)!.visibility).toBe("private");

      // A people change is likewise rejected.
      const peopleRes = await patch(deck.id, { people: [{ person: "mallory", role: "editor" }] });
      expect(peopleRes.status).toBe(403);
      expect(getDeck(deck.id)!.people).toHaveLength(1);
    } finally {
      deleteDeck(deck.id);
    }
  });

  it("does not half-apply a mixed content+sharing request from an editor", async () => {
    const deck = createDeck("Ally's deck 2", [{ front: "a", back: "b" }], "ally");
    setShare(deck.id, { visibility: "private", people: [{ person: "you", role: "editor" }] });
    try {
      const res = await patch(deck.id, { title: "should not stick", visibility: "public" });
      expect(res.status).toBe(403);
      // The content change must NOT have landed either — sharing is checked first.
      expect(getDeck(deck.id)!.title).toBe("Ally's deck 2");
    } finally {
      deleteDeck(deck.id);
    }
  });
});

// The owner's own sharing changes. `public` is every HOSA member in the
// country, so it goes to a reviewer; everything narrower is the owner's call.
describe("PATCH /api/decks/[id] — publishing is a submission", () => {
  beforeEach(() => {
    __resetModerationQueue();
    __resetShareBans();
  });
  afterEach(() => {
    __resetShareBans();
  });

  it("holds the deck at the audience it already had and files the request", async () => {
    const deck = createDeck("Chapter deck", [{ front: "a", back: "b" }], OWNER_KEY);
    setShare(deck.id, { visibility: "chapter", chapter: "Toronto Central" });
    try {
      const res = await patch(deck.id, { visibility: "public" });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.submittedForReview).toBe(true);

      // The heart of it: asking for a wider audience must not cost the one the
      // deck already had. Its chapter keeps reading it while a reviewer decides
      // — anything else teaches people not to ask. A pending submission is
      // itself a hold, so this only survives because the entry is filed AFTER
      // the scope is written.
      expect(body.visibility).toBe("chapter");
      expect(getDeck(deck.id)!.visibility).toBe("chapter");

      const pending = listPending();
      expect(pending).toHaveLength(1);
      expect(pending[0]).toMatchObject({
        resourceId: deck.id,
        kind: "deck",
        owner: OWNER_KEY,
        reason: "submitted",
        requestedVisibility: "public",
      });
    } finally {
      deleteDeck(deck.id);
    }
  });

  it("applies a pull-back to private without asking anyone", async () => {
    const deck = createDeck("Mine", [{ front: "a", back: "b" }], OWNER_KEY);
    setShare(deck.id, { visibility: "chapter", chapter: "Toronto Central" });
    try {
      const res = await patch(deck.id, { visibility: "private" });
      expect((await res.json()).visibility).toBe("private");
      expect(listPending()).toHaveLength(0);
    } finally {
      deleteDeck(deck.id);
    }
  });

  // A ban is enforced from the request session, so a route that names no actor
  // is still covered. Chapter rather than public, so what is measured is the
  // clamp and not the publish gate above.
  it("refuses a banned owner's chapter request and says why", async () => {
    banPublicSharing(OWNER_KEY, "admin", "repeat copyright uploads");
    const deck = createDeck("Banned owner's deck", [{ front: "a", back: "b" }], OWNER_KEY);
    setShare(deck.id, { visibility: "private", chapter: "Toronto Central" });
    try {
      const res = await patch(deck.id, { visibility: "chapter" });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(getDeck(deck.id)!.visibility).toBe("private");
      // Reporting a plain 200 here is what made this look like a save that
      // undid itself on refresh.
      expect(body).toMatchObject({ clamped: true, clampedTo: "private", clampedReason: "sharing_restricted" });
    } finally {
      deleteDeck(deck.id);
    }
  });

  // Adding one person is not a decision about everyone else. The scope used to
  // be seeded from a literal `public` rather than from the deck, so a share
  // dialog with one name in it could answer a question it was never asked.
  it.each(["private", "chapter"] as const)(
    "leaves a %s deck's scope alone when only the people list changes",
    async (visibility) => {
      const deck = createDeck("Scoped", [{ front: "a", back: "b" }], OWNER_KEY);
      setShare(deck.id, { visibility, chapter: "Toronto Central" });
      try {
        const res = await patch(deck.id, { people: [{ person: "ally", role: "viewer" }] });
        expect(res.status).toBe(200);
        expect(getDeck(deck.id)!.visibility).toBe(visibility);
        expect(getDeck(deck.id)!.people).toEqual([{ person: "ally", role: "viewer" }]);
      } finally {
        deleteDeck(deck.id);
      }
    },
  );

  it("leaves an unscoped deck where it was when only the people list changes", async () => {
    // No share row at all — the case the literal default used to answer for.
    const deck = createDeck("Never scoped", [{ front: "a", back: "b" }], OWNER_KEY);
    const before = getDeck(deck.id)!.visibility;
    try {
      await patch(deck.id, { people: [{ person: "ally", role: "viewer" }] });
      expect(getDeck(deck.id)!.visibility).toBe(before);
    } finally {
      deleteDeck(deck.id);
    }
  });
});
