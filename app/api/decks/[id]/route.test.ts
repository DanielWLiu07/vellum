import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";

import { PATCH } from "./route";
import { createDeck, deleteDeck, getDeck } from "@/lib/decks";
import { setShare } from "@/lib/resource-share";

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
