import { beforeEach, describe, expect, it } from "vitest";

import { createDeck as createDeckRaw, deleteDeck, duplicateDeck, getDeck, listDecks, parseCards, updateDeck } from "./decks";

// The store now requires an owner (Google-Docs-style ownership); these
// content-validation tests all create as the demo viewer.
const createDeck = (title: Parameters<typeof createDeckRaw>[0], items: Parameters<typeof createDeckRaw>[1]) =>
  createDeckRaw(title, items, "you");

describe("parseCards", () => {
  it("parses tab-separated (Quizlet) lines", () => {
    const cards = parseCards("Tachycardia\tFast heart rate\nHypoxia\tLow oxygen");
    expect(cards).toEqual([
      { front: "Tachycardia", back: "Fast heart rate" },
      { front: "Hypoxia", back: "Low oxygen" },
    ]);
  });

  it("parses CSV (first comma splits front/back, keeps later commas)", () => {
    const cards = parseCards("Term, a definition, with a comma");
    expect(cards).toEqual([{ front: "Term", back: "a definition, with a comma" }]);
  });

  it("skips blank lines and lines without a separator", () => {
    expect(parseCards("\n\nnoseparator\n  \nA\tB")).toEqual([{ front: "A", back: "B" }]);
  });
});

describe("deck store", () => {
  let created: string[] = [];
  beforeEach(() => {
    for (const id of created) deleteDeck(id);
    created = [];
  });

  it("creates a deck, cleans empty cards, and lists it", () => {
    const d = createDeck("  My deck  ", [
      { front: "a", back: "1" },
      { front: "  ", back: "  " }, // dropped
      { front: "b", back: "2" },
    ]);
    created.push(d.id);
    expect(d.id).toMatch(/^d_/);
    expect(d.title).toBe("My deck");
    expect(d.cards).toHaveLength(2);
    expect(listDecks().some((x) => x.id === d.id && x.cardCount === 2)).toBe(true);
  });

  it("carries card image ids and keeps an image-only card", () => {
    const d = createDeck("Imaged", [
      { front: "labeled", back: "diagram", frontImageId: "img_a", backImageId: "img_b" },
      { front: "", back: "", frontImageId: "img_c" }, // image-only, must be kept
      { front: "", back: "" }, // truly empty, dropped
    ]);
    created.push(d.id);
    expect(d.cards).toHaveLength(2);
    expect(d.cards[0]).toMatchObject({ frontImageId: "img_a", backImageId: "img_b" });
    expect(d.cards[1]).toMatchObject({ frontImageId: "img_c" });
  });

  it("defaults an empty title", () => {
    const d = createDeck("", [{ front: "x", back: "y" }]);
    created.push(d.id);
    expect(d.title).toBe("Untitled deck");
  });

  it("getDeck returns the full deck; delete removes it; sample is immutable", () => {
    const d = createDeck("Temp", [{ front: "x", back: "y" }]);
    expect(getDeck(d.id)?.cards[0]!.front).toBe("x");
    expect(deleteDeck(d.id)).toBe(true);
    expect(getDeck(d.id)).toBeUndefined();
    expect(deleteDeck("sample-deck")).toBe(false);
    expect(getDeck("sample-deck")).toBeDefined();
  });
});

describe("deck ownership + editing", () => {
  it("createDeck records the owner; scope defaults to the shared pool", () => {
    const d = createDeckRaw("Owned", [{ front: "a", back: "b" }], "ava");
    try {
      const got = getDeck(d.id)!;
      expect(got.owner).toBe("ava");
      expect(got.visibility).toBe("public");
      expect(got.people).toEqual([]);
    } finally {
      deleteDeck(d.id);
    }
  });

  it("updateDeck edits title and cards in place", () => {
    const d = createDeck("Before", [{ front: "a", back: "b" }]);
    try {
      const updated = updateDeck(d.id, { title: "After", cards: [{ front: "x", back: "y" }, { front: "z", back: "w" }] })!;
      expect(updated.title).toBe("After");
      expect(updated.cards).toHaveLength(2);
    } finally {
      deleteDeck(d.id);
    }
  });

  it("updateDeck allows emptying a deck (live-editor draft) but the sample stays immutable", () => {
    const d = createDeck("Keep", [{ front: "a", back: "b" }]);
    try {
      // A live-editor draft can be emptied - the editor autosaves what's on screen.
      expect(updateDeck(d.id, { cards: [{ front: "", back: "" }] })).toBeDefined();
      expect(getDeck(d.id)!.cards).toHaveLength(0);
      expect(updateDeck("sample-deck", { title: "hijack" })).toBeUndefined();
    } finally {
      deleteDeck(d.id);
    }
  });

  it("duplicateDeck clones content under the new owner, independently", () => {
    const src = createDeck("Original", [{ front: "a", back: "b" }]);
    const copy = duplicateDeck(src.id, "ben")!;
    try {
      expect(copy.title).toBe("Copy of Original");
      expect(copy.owner).toBe("ben");
      expect(copy.cards).toEqual(src.cards);
      // Deep copy: editing the clone leaves the source untouched.
      updateDeck(copy.id, { cards: [{ front: "changed", back: "c" }] });
      expect(getDeck(src.id)!.cards[0]!.front).toBe("a");
    } finally {
      deleteDeck(src.id);
      deleteDeck(copy.id);
    }
  });
});
