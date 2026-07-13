// Moderation wiring on the create/edit routes: when the (mocked) moderation
// model flags content, the route must return 422 content_flagged and NOT store
// the material. The moderation model itself is unit-tested in lib/moderation;
// here we only prove the routes honor its verdict.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { moderateText, moderateImage } = vi.hoisted(() => ({
  moderateText: vi.fn(),
  moderateImage: vi.fn(),
}));
vi.mock("@/lib/moderation", () => ({
  moderateText,
  moderateImage,
  moderationConfigured: () => true,
  flaggedReason: (r: { categories: string[] }) => r.categories.join(", "),
}));

import { POST as decksPost } from "./decks/route";
import { PATCH as decksPatch } from "./decks/[id]/route";
import { POST as quizzesPost } from "./quizzes/route";
import { POST as imagesPost } from "./images/route";
import { createDeck, deleteDeck, getDeck, listDecks } from "@/lib/decks";
import { listQuizzes } from "@/lib/quizzes";

const ALLOWED = { allowed: true, flagged: false, categories: [], checked: true };
const FLAGGED = { allowed: false, flagged: true, categories: ["violence", "hate"], checked: true };

const jsonReq = (url: string, method: string, body: unknown) =>
  new NextRequest(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

beforeEach(() => {
  process.env.VELLUM_DEMO_MODE = "1";
  moderateText.mockResolvedValue(ALLOWED);
  moderateImage.mockResolvedValue(ALLOWED);
});
afterEach(() => {
  delete process.env.VELLUM_DEMO_MODE;
  vi.clearAllMocks();
});

describe("deck create moderation", () => {
  it("blocks flagged content with 422 + categories and creates no deck", async () => {
    moderateText.mockResolvedValue(FLAGGED);
    const before = listDecks().length;
    const res = await decksPost(
      jsonReq("https://v.test/api/decks", "POST", { title: "x", cards: [{ front: "bad", back: "worse" }] }),
    );
    expect(res.status).toBe(422);
    const j = await res.json();
    expect(j.error).toBe("content_flagged");
    expect(j.categories).toEqual(["violence", "hate"]);
    expect(listDecks().length).toBe(before);
  });

  it("allows clean content (200) and moderates title + both card faces", async () => {
    const res = await decksPost(
      jsonReq("https://v.test/api/decks", "POST", { title: "Cells", cards: [{ front: "term", back: "def" }] }),
    );
    expect(res.status).toBe(200);
    expect(moderateText).toHaveBeenCalledOnce();
    const text = moderateText.mock.calls[0][0] as string;
    expect(text).toContain("Cells");
    expect(text).toContain("term");
    expect(text).toContain("def");
    const { id } = await res.json();
    deleteDeck(id);
  });
});

describe("deck edit moderation", () => {
  it("blocks a flagged edit with 422 and leaves the deck unchanged", async () => {
    const deck = createDeck("Original", [{ front: "a", back: "b" }], "you");
    try {
      moderateText.mockResolvedValue(FLAGGED);
      const res = await decksPatch(
        jsonReq(`https://v.test/api/decks/${deck.id}`, "PATCH", { title: "harmful", cards: [{ front: "x", back: "y" }] }),
        { params: Promise.resolve({ id: deck.id }) },
      );
      expect(res.status).toBe(422);
      expect((await res.json()).error).toBe("content_flagged");
      expect(getDeck(deck.id)!.title).toBe("Original"); // edit did not land
    } finally {
      deleteDeck(deck.id);
    }
  });
});

describe("quiz create moderation", () => {
  it("blocks flagged content with 422 and creates no quiz", async () => {
    moderateText.mockResolvedValue(FLAGGED);
    const before = listQuizzes().length;
    const res = await quizzesPost(
      jsonReq("https://v.test/api/quizzes", "POST", {
        title: "x",
        questions: [{ prompt: "bad?", choices: ["a", "b"], correctIndex: 0 }],
      }),
    );
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe("content_flagged");
    expect(listQuizzes().length).toBe(before);
  });
});

describe("card image moderation", () => {
  it("blocks a flagged image with 422 and does not store it", async () => {
    moderateImage.mockResolvedValue(FLAGGED);
    const fd = new FormData();
    fd.set("file", new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4])], "c.png", { type: "image/png" }));
    const res = await imagesPost(new NextRequest("https://v.test/api/images", { method: "POST", body: fd }));
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe("content_flagged");
    expect(moderateImage).toHaveBeenCalledOnce();
  });

  it("allows a clean image (200) and moderates the actual bytes", async () => {
    const fd = new FormData();
    fd.set("file", new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 9, 9, 9, 9])], "c.png", { type: "image/png" }));
    const res = await imagesPost(new NextRequest("https://v.test/api/images", { method: "POST", body: fd }));
    expect(res.status).toBe(200);
    expect(moderateImage).toHaveBeenCalledOnce();
    const [bytes, ct] = moderateImage.mock.calls[0];
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(ct).toBe("image/png");
  });
});
