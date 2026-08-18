// Exam-attempts review API: who may list attempts, and who may void them.
//
// The owner and admins see every attempt on a quiz, as they always have.
// Chapter staff (trainer/advisor) can now READ too, but only attempts by
// members of their own chapter — the coaching case, since a trainer works off
// HOSA-authored exams they did not write, which left their own students'
// scores as the ones they could never see. Voiding stayed with the owner.
//
// Non-owners with no claim still get a 404 (no existence leak), and an attempt
// from another quiz can't be voided via a quiz you happen to own.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";

import { GET, PATCH } from "./route";
import { SESSION_COOKIE } from "@/lib/auth";
import { type Identity, type MintIdentityOptions, mintIdentityToken } from "@/lib/identity-token";
import { createQuiz, deleteQuiz } from "@/lib/quizzes";
import { __resetAttempts, listAttempts, recordAttempt } from "@/lib/quiz-attempts";
import { __resetProfile } from "@/lib/profile";
import { setShare } from "@/lib/resource-share";
import { __resetUsers, rememberUser } from "@/lib/users";

// Admin comes from the signed session, never from the local profile (role isn't
// patchable — that was a self-escalation path). MEMBER keeps the "you" owner key
// the quizzes below are seeded with, so "the owner" really is the caller.
const SECRET = "shared-secret-at-least-16-chars";
const MEMBER = { sub: "you", name: "You", chapter: "Toronto Central", role: "student" } as const;
const ADMIN = { sub: "admin_1", name: "Daniel Liu", chapter: "HOSA Canada", role: "admin" } as const;
// Structural rather than a union of the two constants, so the chapter-staff
// personas below can use the same request helpers.
type Person = {
  sub: string;
  name: string;
  chapter: string;
  role: NonNullable<MintIdentityOptions["role"]>;
};
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
  __resetUsers();
});
afterEach(() => {
  for (const id of ids) deleteQuiz(id);
  ids = [];
  __resetAttempts();
  __resetUsers();
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

/* ------------------------------------------------- chapter-staff oversight */

const TC = "chp_toronto_central";
const VW = "chp_vancouver_west";
const STAFF = {
  rivera: { sub: "t_rivera", name: "Coach Rivera", chapter: TC, role: "trainer" },
  lefebvre: { sub: "a_lefebvre", name: "Ms. Lefebvre", chapter: TC, role: "advisor" },
  ada: { sub: "s_ada", name: "Ada Okafor", chapter: TC, role: "student" },
  liam: { sub: "s_liam", name: "Liam Tremblay", chapter: TC, role: "student" },
  zoe: { sub: "s_zoe", name: "Zoe Roy", chapter: VW, role: "student" },
  author: { sub: "t_author", name: "Quiz Author", chapter: VW, role: "trainer" },
} as const satisfies Record<string, Person>;

/** Vitals only knows members who have entered at least once (lib/users). */
const known = (p: Person) => rememberUser({ ...p, exp: 9e9, iat: 0 } as Identity);

describe("chapter staff reviewing their own members", () => {
  // Authored by someone in ANOTHER chapter — the case that matters, because
  // that is what official HOSA content looks like to a chapter's own trainer.
  let quizId = "";
  beforeEach(() => {
    for (const p of Object.values(STAFF)) known(p);
    const q = createQuiz("Airway Management", QS, STAFF.author.sub, { timeLimitSec: 600 });
    quizId = q.id;
    ids.push(q.id);
  });

  it("shows a trainer their own chapter's takers on a quiz they did not write", async () => {
    seedAttempt(quizId, STAFF.ada.sub);
    seedAttempt(quizId, STAFF.liam.sub);

    const res = await get(STAFF.rivera, quizId);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.scope).toBe("chapter");
    expect(body.attempts.map((a: { taker: string }) => a.taker).sort()).toEqual([
      STAFF.ada.sub,
      STAFF.liam.sub,
    ]);
  });

  // The whole point of filtering rows rather than widening the door. Drop the
  // filter and this is the test that fails.
  it("does NOT include another chapter's taker on the same shared quiz", async () => {
    seedAttempt(quizId, STAFF.ada.sub);
    seedAttempt(quizId, STAFF.zoe.sub);

    const body = await (await get(STAFF.rivera, quizId)).json();

    expect(body.attempts).toHaveLength(1);
    expect(body.attempts[0].taker).toBe(STAFF.ada.sub);
    // Both attempts exist; only one was shown.
    expect(listAttempts(quizId)).toHaveLength(2);
  });

  it("gives an advisor the same chapter scope as a trainer", async () => {
    seedAttempt(quizId, STAFF.ada.sub);
    seedAttempt(quizId, STAFF.zoe.sub);

    const body = await (await get(STAFF.lefebvre, quizId)).json();

    expect(body.scope).toBe("chapter");
    expect(body.attempts).toHaveLength(1);
  });

  it("omits a taker the signed directory doesn't know rather than guessing", async () => {
    seedAttempt(quizId, STAFF.ada.sub);
    seedAttempt(quizId, "ghost_never_entered");

    const body = await (await get(STAFF.rivera, quizId)).json();

    expect(body.attempts).toHaveLength(1);
    expect(body.attempts[0].taker).toBe(STAFF.ada.sub);
  });

  it("still answers the owner with every attempt, scope 'all'", async () => {
    seedAttempt(quizId, STAFF.ada.sub);
    seedAttempt(quizId, STAFF.zoe.sub);

    const body = await (await get(STAFF.author, quizId)).json();

    expect(body.scope).toBe("all");
    expect(body.attempts).toHaveLength(2);
  });

  // Answering 200-with-an-empty-list on a quiz they can't see would confirm it
  // exists, which is the leak the blanket 404 was there to prevent.
  it("cannot review attempts on a quiz it can't see, and learns nothing from trying", async () => {
    setShare(quizId, { visibility: "private", chapter: VW });
    seedAttempt(quizId, STAFF.ada.sub);

    const res = await get(STAFF.rivera, quizId);

    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("not_found");
  });

  it("refuses a trainer voiding an attempt, even for their own chapter's member", async () => {
    const a = seedAttempt(quizId, STAFF.ada.sub);

    const res = await patch(STAFF.rivera, quizId, { attemptId: a.id });

    expect(res.status).toBe(404);
    // Refused, not quietly half-applied.
    expect(listAttempts(quizId)[0].voided).toBeFalsy();
  });
});
