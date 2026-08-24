// Grade endpoint: practice quizzes return the answer key (learn from misses);
// exam quizzes WITHHOLD the key and record a persisted attempt with flags.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";

import { POST } from "./route";
import { createQuiz, deleteQuiz } from "@/lib/quizzes";
import { __resetAttempts, listAttempts } from "@/lib/quiz-attempts";
import { __resetProfile } from "@/lib/profile";
import { __resetRateLimit } from "@/lib/rate-limit";

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
  // Counters are process-global and keyed per IP; every test here shares the
  // one "unknown" IP, so without this the file's own calls exhaust the window.
  __resetRateLimit();
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

// Grading persists a row in exam mode, so it is a write like any other and gets
// the same limiter. It is also what made eviction abusable: without a ceiling
// on submissions, a member could submit in a loop until the cap pushed records
// out (see lib/quiz-attempts). The per-taker cap fixed the deletion; this stops
// the loop being free.
describe("POST grade — rate limiting", () => {
  const flood = async (id: string, n: number) => {
    let last: Response | undefined;
    for (let i = 0; i < n; i++) last = await call(id, { answers: [1, 0] });
    return last!;
  };

  it("429s once a caller submits far more than a member ever would", async () => {
    const q = createQuiz("Exam", QS, "you", { timeLimitSec: 600 });
    ids.push(q.id);
    const res = await flood(q.id, 40);
    expect(res.status).toBe(429);
    expect((await res.json()).error).toBe("rate_limited");
    expect(res.headers.get("Retry-After")).toBeTruthy();
  });

  it("leaves an ordinary run of attempts alone", async () => {
    const q = createQuiz("Exam", QS, "you", { timeLimitSec: 600 });
    ids.push(q.id);
    // A re-sit, a practice pass, a reload - nowhere near the ceiling.
    for (let i = 0; i < 5; i++) {
      expect((await call(q.id, { answers: [1, 0] })).status).toBe(200);
    }
  });

  it("bounds how many attempts a flood can persist", async () => {
    const q = createQuiz("Exam", QS, "you", { timeLimitSec: 600 });
    ids.push(q.id);
    await flood(q.id, 60);
    // Whatever got through is capped by the limiter, not by evicting records.
    expect(listAttempts(q.id).length).toBeLessThanOrEqual(30);
  });
});
