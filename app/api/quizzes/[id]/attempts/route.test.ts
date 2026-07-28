// Exam-attempts review API: only the quiz owner or an admin may list attempts
// or void/reinstate them. Non-owners get a 404 (no existence leak), and an
// attempt from another quiz can't be voided via a quiz you happen to own.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";

import { GET, PATCH } from "./route";
import { SESSION_COOKIE } from "@/lib/auth";
import { mintIdentityToken } from "@/lib/identity-token";
import { createQuiz, deleteQuiz } from "@/lib/quizzes";
import { __resetAttempts, recordAttempt } from "@/lib/quiz-attempts";
import { __resetProfile } from "@/lib/profile";

// Admin comes from the signed session, never from the local profile (role isn't
// patchable — that was a self-escalation path). MEMBER keeps the "you" owner key
// the quizzes below are seeded with, so "the owner" really is the caller.
const SECRET = "shared-secret-at-least-16-chars";
const MEMBER = { sub: "you", name: "You", chapter: "Toronto Central", role: "student" } as const;
const ADMIN = { sub: "admin_1", name: "Daniel Liu", chapter: "HOSA Canada", role: "admin" } as const;
type Person = typeof MEMBER | typeof ADMIN;
const cookie = (p: Person) => `${SESSION_COOKIE}=${mintIdentityToken(SECRET, { ...p })}`;

const get = (who: Person, id: string) =>
  GET(new NextRequest(`https://v.test/api/quizzes/${id}/attempts`, { headers: { Cookie: cookie(who) } }), { params: Promise.resolve({ id }) });
const patch = (who: Person, id: string, body: unknown) =>
  PATCH(
    new NextRequest(`https://v.test/api/quizzes/${id}/attempts`, {
      method: "PATCH",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json", Cookie: cookie(who) },
    }),
    { params: Promise.resolve({ id }) },
  );

const QS = [{ prompt: "q", choices: ["a", "b"], correctIndex: 0 }];
const seedAttempt = (quizId: string, taker = "student_1") =>
  recordAttempt({ quizId, taker, score: 1, total: 1, startedAt: Date.now() - 5000, timeLimitSec: 300, autoSubmitted: false, flags: [] });

let ids: string[] = [];
beforeEach(() => {
  process.env.VELLUM_DEMO_MODE = "1";
  process.env.VITALS_AUTH_SECRET = SECRET;
  __resetProfile();
  __resetAttempts();
});
afterEach(() => {
  for (const id of ids) deleteQuiz(id);
  ids = [];
  __resetAttempts();
  delete process.env.VELLUM_DEMO_MODE;
  delete process.env.VITALS_AUTH_SECRET;
});

describe("GET /api/quizzes/[id]/attempts", () => {
  it("lets the owner list attempts", async () => {
    const q = createQuiz("Exam", QS, "you", { timeLimitSec: 300 });
    ids.push(q.id);
    seedAttempt(q.id);
    const res = await get(MEMBER, q.id);
    expect(res.status).toBe(200);
    expect((await res.json()).attempts).toHaveLength(1);
  });

  it("404s a non-owner (no existence leak)", async () => {
    const q = createQuiz("Exam", QS, "someone-else", { timeLimitSec: 300 });
    ids.push(q.id);
    seedAttempt(q.id);
    expect((await get(MEMBER, q.id)).status).toBe(404); // viewer "you" is not the owner
  });

  it("lets an admin list any quiz's attempts", async () => {
    const q = createQuiz("Exam", QS, "someone-else", { timeLimitSec: 300 });
    ids.push(q.id);
    seedAttempt(q.id);
    expect((await get(ADMIN, q.id)).status).toBe(200);
  });

  it("404s a missing quiz", async () => {
    expect((await get(MEMBER, "nope")).status).toBe(404);
  });

  it("404s when the dashboard is disabled", async () => {
    delete process.env.VELLUM_DEMO_MODE;
    const q = createQuiz("Exam", QS, "you", { timeLimitSec: 300 });
    ids.push(q.id);
    expect((await get(MEMBER, q.id)).status).toBe(404);
  });
});

describe("PATCH /api/quizzes/[id]/attempts", () => {
  it("voids then reinstates an attempt for the owner", async () => {
    const q = createQuiz("Exam", QS, "you", { timeLimitSec: 300 });
    ids.push(q.id);
    const a = seedAttempt(q.id);
    const voided = await (await patch(MEMBER, q.id, { attemptId: a.id, reason: "left repeatedly" })).json();
    expect(voided.attempt.voided).toBe(true);
    expect(voided.attempt.voidReason).toBe("left repeatedly");
    const reinstated = await (await patch(MEMBER, q.id, { attemptId: a.id, void: false })).json();
    expect(reinstated.attempt.voided).toBe(false);
  });

  it("refuses to void an attempt that belongs to another quiz", async () => {
    const mine = createQuiz("Mine", QS, "you", { timeLimitSec: 300 });
    const other = createQuiz("Other", QS, "you", { timeLimitSec: 300 });
    ids.push(mine.id, other.id);
    const foreign = seedAttempt(other.id);
    // Pass the foreign attempt id to MY quiz's endpoint - must not void it.
    expect((await patch(MEMBER, mine.id, { attemptId: foreign.id, void: true })).status).toBe(404);
  });

  it("404s a non-owner trying to void", async () => {
    const q = createQuiz("Exam", QS, "someone-else", { timeLimitSec: 300 });
    ids.push(q.id);
    const a = seedAttempt(q.id);
    expect((await patch(MEMBER, q.id, { attemptId: a.id, void: true })).status).toBe(404);
  });
});
