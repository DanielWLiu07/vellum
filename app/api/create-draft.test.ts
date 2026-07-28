// Create-with-settings flow: a deck/quiz can be created empty (a draft you fill
// in from its live editor), and the visibility chosen on the create screen is
// applied. Content moderation still runs on whatever text is provided.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/moderation", () => {
  const CLEAN = { allowed: true, flagged: false, categories: [], checked: true };
  return {
    moderateText: vi.fn().mockResolvedValue(CLEAN),
    moderateImage: vi.fn().mockResolvedValue(CLEAN),
    moderationConfigured: () => false,
    flaggedReason: (r: { categories: string[] }) => r.categories.join(", "),
  };
});

import { POST as decksPost } from "./decks/route";
import { POST as quizzesPost } from "./quizzes/route";
import { getDeck, deleteDeck } from "@/lib/decks";
import { getQuiz, deleteQuiz } from "@/lib/quizzes";
import { __resetRateLimit } from "@/lib/rate-limit";
import { __resetProfile } from "@/lib/profile";

const jsonReq = (url: string, body: unknown) =>
  new NextRequest(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

beforeEach(() => {
  process.env.VELLUM_DEMO_MODE = "1";
  __resetRateLimit();
  __resetProfile();
});
afterEach(() => {
  delete process.env.VELLUM_DEMO_MODE;
  vi.clearAllMocks();
});

describe("create empty drafts with settings", () => {
  it("creates an empty deck draft and applies the chosen visibility", async () => {
    const res = await decksPost(jsonReq("https://v.test/api/decks", { title: "Draft", cards: [], visibility: "private" }));
    expect(res.status).toBe(200);
    const { id } = await res.json();
    try {
      const deck = getDeck(id)!;
      expect(deck.cards).toHaveLength(0);
      expect(deck.visibility).toBe("private");
    } finally {
      deleteDeck(id);
    }
  });

  it("creates an empty quiz draft and applies the chosen visibility", async () => {
    const res = await quizzesPost(jsonReq("https://v.test/api/quizzes", { title: "Draft", questions: [], visibility: "chapter" }));
    expect(res.status).toBe(200);
    const { id } = await res.json();
    try {
      const quiz = getQuiz(id)!;
      expect(quiz.questions).toHaveLength(0);
      expect(quiz.visibility).toBe("chapter");
    } finally {
      deleteQuiz(id);
    }
  });

  it("defaults to the shared pool (public) when no visibility is given", async () => {
    const res = await decksPost(jsonReq("https://v.test/api/decks", { title: "NoVis", cards: [] }));
    const { id } = await res.json();
    try {
      expect(getDeck(id)!.visibility).toBe("public");
    } finally {
      deleteDeck(id);
    }
  });
});
