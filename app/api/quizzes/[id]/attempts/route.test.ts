// Exam-attempts review API: only the quiz owner or an admin may list attempts
// or void/reinstate them. Non-owners get a 404 (no existence leak), and an
// attempt from another quiz can't be voided via a quiz you happen to own.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";

import { GET, PATCH } from "./route";
import { createQuiz, deleteQuiz } from "@/lib/quizzes";
import { __resetAttempts, recordAttempt } from "@/lib/quiz-attempts";
import { __resetProfile, updateProfile } from "@/lib/profile";

const get = (id: string) =>
  GET(new NextRequest(`https://v.test/api/quizzes/${id}/attempts`), { params: Promise.resolve({ id }) });
const patch = (id: string, body: unknown) =>
  PATCH(
    new NextRequest(`https://v.test/api/quizzes/${id}/attempts`, {
      method: "PATCH",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    }),
    { params: Promise.resolve({ id }) },
  );

const QS = [{ prompt: "q", choices: ["a", "b"], correctIndex: 0 }];
const seedAttempt = (quizId: string, taker = "student_1") =>
  recordAttempt({ quizId, taker, score: 1, total: 1, startedAt: Date.now() - 5000, timeLimitSec: 300, autoSubmitted: false, flags: [] });

let ids: string[] = [];
beforeEach(() => {
  process.env.VELLUM_DEMO_MODE = "1";
  __resetProfile();
  __resetAttempts();
});
afterEach(() => {
  for (const id of ids) deleteQuiz(id);
  ids = [];
  __resetAttempts();
  delete process.env.VELLUM_DEMO_MODE;
});

describe("GET /api/quizzes/[id]/attempts", () => {
  it("lets the owner list attempts", async () => {
    const q = createQuiz("Exam", QS, "you", { timeLimitSec: 300 });
    ids.push(q.id);
    seedAttempt(q.id);
    const res = await get(q.id);
    expect(res.status).toBe(200);
    expect((await res.json()).attempts).toHaveLength(1);
  });

  it("404s a non-owner (no existence leak)", async () => {
    const q = createQuiz("Exam", QS, "someone-else", { timeLimitSec: 300 });
    ids.push(q.id);
    seedAttempt(q.id);
    expect((await get(q.id)).status).toBe(404); // viewer "you" is not the owner
  });

  it("lets an admin list any quiz's attempts", async () => {
    updateProfile({ role: "admin" });
    const q = createQuiz("Exam", QS, "someone-else", { timeLimitSec: 300 });
    ids.push(q.id);
    seedAttempt(q.id);
    expect((await get(q.id)).status).toBe(200);
  });

  it("404s a missing quiz", async () => {
    expect((await get("nope")).status).toBe(404);
  });

  it("404s when the dashboard is disabled", async () => {
    delete process.env.VELLUM_DEMO_MODE;
    const q = createQuiz("Exam", QS, "you", { timeLimitSec: 300 });
    ids.push(q.id);
    expect((await get(q.id)).status).toBe(404);
  });
});

describe("PATCH /api/quizzes/[id]/attempts", () => {
  it("voids then reinstates an attempt for the owner", async () => {
    const q = createQuiz("Exam", QS, "you", { timeLimitSec: 300 });
    ids.push(q.id);
    const a = seedAttempt(q.id);
    const voided = await (await patch(q.id, { attemptId: a.id, reason: "left repeatedly" })).json();
    expect(voided.attempt.voided).toBe(true);
    expect(voided.attempt.voidReason).toBe("left repeatedly");
    const reinstated = await (await patch(q.id, { attemptId: a.id, void: false })).json();
    expect(reinstated.attempt.voided).toBe(false);
  });

  it("refuses to void an attempt that belongs to another quiz", async () => {
    const mine = createQuiz("Mine", QS, "you", { timeLimitSec: 300 });
    const other = createQuiz("Other", QS, "you", { timeLimitSec: 300 });
    ids.push(mine.id, other.id);
    const foreign = seedAttempt(other.id);
    // Pass the foreign attempt id to MY quiz's endpoint - must not void it.
    expect((await patch(mine.id, { attemptId: foreign.id, void: true })).status).toBe(404);
  });

  it("404s a non-owner trying to void", async () => {
    const q = createQuiz("Exam", QS, "someone-else", { timeLimitSec: 300 });
    ids.push(q.id);
    const a = seedAttempt(q.id);
    expect((await patch(q.id, { attemptId: a.id, void: true })).status).toBe(404);
  });
});
