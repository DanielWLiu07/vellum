// Sharing a quiz: the same rules decks and documents follow. `public` is every
// HOSA member in the country and goes to a reviewer; a ban is enforced whether
// or not the route thought to mention who was asking; and adding one person
// answers only the question it was asked.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";

import { PATCH } from "./route";
import { __resetModerationQueue, listPending } from "@/lib/moderation-queue";
import { OWNER_KEY } from "@/lib/profile-types";
import { createQuiz, deleteQuiz, getQuiz } from "@/lib/quizzes";
import { setShare } from "@/lib/resource-share";
import { __resetShareBans, banPublicSharing } from "@/lib/share-ban";

const QUESTIONS = [{ prompt: "Resting HR over 100?", choices: ["Brady", "Tachy"], correctIndex: 1 }];

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const patch = (id: string, body: unknown) =>
  PATCH(
    new NextRequest(`https://v.test/api/quizzes/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    ctx(id),
  );

beforeEach(() => {
  process.env.VELLUM_DEMO_MODE = "1";
  __resetModerationQueue();
  __resetShareBans();
});
afterEach(() => {
  delete process.env.VELLUM_DEMO_MODE;
  __resetShareBans();
});

describe("PATCH /api/quizzes/[id] — publishing is a submission", () => {
  it("holds the quiz at the audience it already had and files the request", async () => {
    const quiz = createQuiz("Chapter quiz", QUESTIONS, OWNER_KEY);
    setShare(quiz.id, { visibility: "chapter", chapter: "Toronto Central" });
    try {
      const res = await patch(quiz.id, { visibility: "public" });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.submittedForReview).toBe(true);

      // Asking for a wider audience must not cost the one the quiz already had.
      // A pending submission is itself a hold, so this only survives because
      // the entry is filed AFTER the scope is written.
      expect(body.visibility).toBe("chapter");
      expect(getQuiz(quiz.id)!.visibility).toBe("chapter");

      const pending = listPending();
      expect(pending).toHaveLength(1);
      expect(pending[0]).toMatchObject({
        resourceId: quiz.id,
        kind: "quiz",
        owner: OWNER_KEY,
        reason: "submitted",
        requestedVisibility: "public",
      });
    } finally {
      deleteQuiz(quiz.id);
    }
  });

  it("applies a pull-back to private without asking anyone", async () => {
    const quiz = createQuiz("Mine", QUESTIONS, OWNER_KEY);
    setShare(quiz.id, { visibility: "chapter", chapter: "Toronto Central" });
    try {
      const res = await patch(quiz.id, { visibility: "private" });
      expect((await res.json()).visibility).toBe("private");
      expect(listPending()).toHaveLength(0);
    } finally {
      deleteQuiz(quiz.id);
    }
  });

  it("refuses a banned owner's chapter request and says why", async () => {
    banPublicSharing(OWNER_KEY, "admin", "repeat copyright uploads");
    const quiz = createQuiz("Banned owner's quiz", QUESTIONS, OWNER_KEY);
    setShare(quiz.id, { visibility: "private", chapter: "Toronto Central" });
    try {
      const res = await patch(quiz.id, { visibility: "chapter" });
      expect(res.status).toBe(200);
      expect(getQuiz(quiz.id)!.visibility).toBe("private");
      expect(await res.json()).toMatchObject({
        clamped: true,
        clampedTo: "private",
        clampedReason: "sharing_restricted",
      });
    } finally {
      deleteQuiz(quiz.id);
    }
  });

  it.each(["private", "chapter"] as const)(
    "leaves a %s quiz's scope alone when only the people list changes",
    async (visibility) => {
      const quiz = createQuiz("Scoped", QUESTIONS, OWNER_KEY);
      setShare(quiz.id, { visibility, chapter: "Toronto Central" });
      try {
        const res = await patch(quiz.id, { people: [{ person: "ally", role: "viewer" }] });
        expect(res.status).toBe(200);
        expect(getQuiz(quiz.id)!.visibility).toBe(visibility);
        expect(getQuiz(quiz.id)!.people).toEqual([{ person: "ally", role: "viewer" }]);
      } finally {
        deleteQuiz(quiz.id);
      }
    },
  );

  it("leaves an unscoped quiz where it was when only the people list changes", async () => {
    // No share row at all — the case the literal default used to answer for.
    const quiz = createQuiz("Never scoped", QUESTIONS, OWNER_KEY);
    const before = getQuiz(quiz.id)!.visibility;
    try {
      await patch(quiz.id, { people: [{ person: "ally", role: "viewer" }] });
      expect(getQuiz(quiz.id)!.visibility).toBe(before);
    } finally {
      deleteQuiz(quiz.id);
    }
  });
});
