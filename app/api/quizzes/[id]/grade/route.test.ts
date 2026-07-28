// Grade endpoint: practice quizzes return the answer key (learn from misses);
// exam quizzes WITHHOLD the key and record a persisted attempt with flags.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";

import { POST } from "./route";
import { createQuiz, deleteQuiz } from "@/lib/quizzes";
import { __resetAttempts, listAttempts } from "@/lib/quiz-attempts";
import { __resetProfile } from "@/lib/profile";

const call = (id: string, body: unknown) =>
  POST(
    new NextRequest(`https://v.test/api/quizzes/${id}/grade`, {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    }),
    { params: Promise.resolve({ id }) },
  );

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

const QS = [
  { prompt: "1", choices: ["a", "b"], correctIndex: 1 },
  { prompt: "2", choices: ["a", "b"], correctIndex: 0 },
];

describe("POST grade — practice mode", () => {
  it("returns the score AND the answer key", async () => {
    const q = createQuiz("Practice", QS, "you");
    ids.push(q.id);
    const res = await call(q.id, { answers: [1, 0] });
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.score).toBe(2);
    expect(j.total).toBe(2);
    expect(j.correctIndexes).toEqual([1, 0]); // key revealed for study
    expect(listAttempts(q.id)).toHaveLength(0); // practice records nothing
  });
});

describe("POST grade — exam mode", () => {
  it("withholds the answer key and records an attempt", async () => {
    const q = createQuiz("Exam", QS, "you", { timeLimitSec: 600 });
    ids.push(q.id);
    const res = await call(q.id, { answers: [1, 1], startedAt: Date.now() - 30_000, autoSubmitted: false, flags: [] });
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.exam).toBe(true);
    expect(j.score).toBe(1);
    expect(j.correctIndexes).toBeUndefined(); // key NEVER sent in exam mode
    expect(j.correct).toBeUndefined();
    const attempts = listAttempts(q.id);
    expect(attempts).toHaveLength(1);
    expect(attempts[0].score).toBe(1);
  });

  it("auto-voids an attempt whose integrity flags cross the bar", async () => {
    const q = createQuiz("Exam", QS, "you", { timeLimitSec: 600 });
    ids.push(q.id);
    const flags = [
      { kind: "hidden", at: 1000 },
      { kind: "blur", at: 2000 },
      { kind: "fullscreen-exit", at: 3000 },
    ];
    const res = await call(q.id, { answers: [1, 0], startedAt: Date.now() - 10_000, flags });
    const j = await res.json();
    expect(j.voided).toBe(true);
    expect(listAttempts(q.id)[0].voided).toBe(true);
  });

  it("carries autoSubmitted through to the attempt", async () => {
    const q = createQuiz("Exam", QS, "you", { timeLimitSec: 600 });
    ids.push(q.id);
    await call(q.id, { answers: [1, 0], startedAt: Date.now() - 5_000, autoSubmitted: true, flags: [] });
    expect(listAttempts(q.id)[0].autoSubmitted).toBe(true);
  });
});
