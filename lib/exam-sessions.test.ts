// Exam sessions. Every case fixes the clock explicitly - `now` is injectable
// precisely so a test can sit ON a deadline rather than near one.
//
// The properties worth defending here are the ones a taker would otherwise get
// for free: a reload must not mint a new clock, a closed tab must not erase the
// telemetry, and a late submission must be recorded rather than refused.

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  BEAT_INTERVAL_MS,
  SUBMIT_GRACE_MS,
  __resetExamSessions,
  closeSession,
  getSession,
  isPastGrace,
  openSession,
  openSessionFor,
  recordBeat,
  remainingSec,
  sessionsFor,
  sweepStale,
} from "./exam-sessions";

const T0 = 1_800_000_000_000;
const LIMIT_SEC = 600;
const LIMIT_MS = LIMIT_SEC * 1000;
const ADA = "s_ada";
const LIAM = "s_liam";
const QUIZ = "q_cardio";

const open = (patch: Partial<Parameters<typeof openSession>[0]> = {}) =>
  openSession({ quizId: QUIZ, taker: ADA, timeLimitSec: LIMIT_SEC, now: T0, ...patch });

/** Open a sitting and hand back the session, failing loudly if it didn't. */
const started = (patch: Partial<Parameters<typeof openSession>[0]> = {}) => {
  const res = open(patch);
  if (!res.ok) throw new Error("expected the session to open");
  return res.session;
};

beforeEach(() => __resetExamSessions());
afterEach(() => __resetExamSessions());

describe("openSession", () => {
  it("stamps the clock from the server and fixes the deadline", () => {
    const s = started();
    expect(s.id).toMatch(/^es_/);
    expect(s.startedAt).toBe(T0);
    expect(s.deadline).toBe(T0 + LIMIT_MS);
    expect(s.status).toBe("open");
    expect(s.flags).toEqual([]);
    expect(s.answers).toEqual([]);
  });

  it("RESUMES an open sitting instead of minting a new clock", () => {
    // The reload case, and the reason the whole module exists. Re-opening ten
    // minutes in must return the original deadline, not a fresh one.
    const first = started();
    const again = open({ now: T0 + 10 * 60_000 });
    expect(again.ok && again.resumed).toBe(true);
    expect(again.ok && again.session.id).toBe(first.id);
    expect(again.ok && again.session.deadline).toBe(T0 + LIMIT_MS);
    expect(sessionsFor(QUIZ, ADA)).toHaveLength(1);
  });

  it("resumes with the progress already recorded, so nothing is retyped", () => {
    const s = started();
    recordBeat({ sessionId: s.id, taker: ADA, answers: [1, -1, 3], now: T0 + 60_000 });
    const again = open({ now: T0 + 120_000 });
    expect(again.ok && again.session.answers).toEqual([1, -1, 3]);
  });

  it("resumes even past the deadline - the sitting is still the same sitting", () => {
    const first = started();
    const again = open({ now: T0 + LIMIT_MS + 5 * 60_000 });
    expect(again.ok && again.resumed).toBe(true);
    expect(again.ok && again.session.id).toBe(first.id);
  });

  it("gives a different member their own sitting", () => {
    const ada = started();
    const liam = started({ taker: LIAM, now: T0 + 1000 });
    expect(liam.id).not.toBe(ada.id);
    expect(liam.deadline).toBe(T0 + 1000 + LIMIT_MS);
  });

  it("opens a NEW sitting once the previous one is finished (a retake)", () => {
    const first = started();
    closeSession({ sessionId: first.id, taker: ADA, now: T0 + 60_000 });
    const second = open({ now: T0 + 120_000 });
    expect(second.ok && second.resumed).toBe(false);
    expect(second.ok && second.session.id).not.toBe(first.id);
    // Both sittings are countable, which is what makes a retake limit possible.
    expect(sessionsFor(QUIZ, ADA)).toHaveLength(2);
  });

  it("refuses a blank quiz, a blank taker, or a nonsense limit", () => {
    expect(open({ quizId: "" }).ok).toBe(false);
    expect(open({ taker: "" }).ok).toBe(false);
    expect(open({ timeLimitSec: 0 }).ok).toBe(false);
    expect(open({ timeLimitSec: Number.NaN }).ok).toBe(false);
  });
});

describe("remainingSec", () => {
  it("counts down from the deadline and never goes negative", () => {
    const s = started();
    expect(remainingSec(s, T0)).toBe(LIMIT_SEC);
    expect(remainingSec(s, T0 + 60_000)).toBe(LIMIT_SEC - 60);
    expect(remainingSec(s, T0 + LIMIT_MS)).toBe(0);
    expect(remainingSec(s, T0 + LIMIT_MS + 60_000)).toBe(0);
  });
});

describe("recordBeat", () => {
  it("accumulates flags across beats so a closed tab cannot erase them", () => {
    // The flags only ever lived in a browser ref before; this is the property
    // that makes walking away leave a trace.
    const s = started();
    recordBeat({ sessionId: s.id, taker: ADA, flags: [{ kind: "blur", at: 1000 }], now: T0 + BEAT_INTERVAL_MS });
    recordBeat({ sessionId: s.id, taker: ADA, flags: [{ kind: "hidden", at: 4000 }], now: T0 + 2 * BEAT_INTERVAL_MS });
    expect(getSession(s.id)?.flags).toEqual([
      { kind: "blur", at: 1000 },
      { kind: "hidden", at: 4000 },
    ]);
  });

  it("REPLACES answers rather than accumulating them", () => {
    // A flag is an event that cannot un-happen; the answer array is current
    // state, so the newest beat is simply the truest version of it.
    const s = started();
    recordBeat({ sessionId: s.id, taker: ADA, answers: [0, -1], now: T0 + 15_000 });
    recordBeat({ sessionId: s.id, taker: ADA, answers: [0, 2], now: T0 + 30_000 });
    expect(getSession(s.id)?.answers).toEqual([0, 2]);
  });

  it("sanitises junk telemetry instead of storing it", () => {
    const s = started();
    recordBeat({
      sessionId: s.id,
      taker: ADA,
      flags: [{ kind: "blur", at: 10 }, { kind: "not-a-kind", at: 20 }, "garbage"],
      answers: [1, "x", 9.7, -5, null],
      now: T0 + 15_000,
    });
    const saved = getSession(s.id)!;
    expect(saved.flags).toEqual([{ kind: "blur", at: 10 }]);
    expect(saved.answers).toEqual([1, -1, 9, -1, -1]);
  });

  it("never invents an answer out of a falsy value", () => {
    // Number(null), Number(""), Number([]) and Number(false) are all 0, which
    // is a VALID choice index - so loose coercion would silently answer a
    // question the member skipped with the first option.
    const s = started();
    recordBeat({
      sessionId: s.id, taker: ADA,
      answers: [null, undefined, "", [], false, {}],
      now: T0 + 15_000,
    });
    expect(getSession(s.id)?.answers).toEqual([-1, -1, -1, -1, -1, -1]);
  });

  it("moves lastBeatAt, which is what makes silence measurable", () => {
    const s = started();
    recordBeat({ sessionId: s.id, taker: ADA, now: T0 + 45_000 });
    expect(getSession(s.id)?.lastBeatAt).toBe(T0 + 45_000);
  });

  it("still accepts a beat past the deadline", () => {
    // Refusing overtime telemetry would only delete the record of what the
    // taker did in overtime - the opposite of useful.
    const s = started();
    const res = recordBeat({ sessionId: s.id, taker: ADA, flags: [{ kind: "hidden", at: 5 }], now: T0 + LIMIT_MS + 30_000 });
    expect(res.ok).toBe(true);
    expect(res.ok && res.remainingSec).toBe(0);
    expect(getSession(s.id)?.flags).toHaveLength(1);
  });

  it("refuses another member - a session id is not a capability", () => {
    const s = started();
    const res = recordBeat({ sessionId: s.id, taker: LIAM, flags: [{ kind: "blur", at: 1 }], now: T0 + 15_000 });
    expect(res).toEqual({ ok: false, error: "forbidden" });
    expect(getSession(s.id)?.flags).toEqual([]);
  });

  it("refuses an unknown session, and one already finished", () => {
    expect(recordBeat({ sessionId: "es_nope", taker: ADA, now: T0 })).toEqual({ ok: false, error: "not_found" });
    const s = started();
    closeSession({ sessionId: s.id, taker: ADA, now: T0 + 60_000 });
    expect(recordBeat({ sessionId: s.id, taker: ADA, now: T0 + 90_000 })).toEqual({ ok: false, error: "closed" });
  });
});

describe("closeSession", () => {
  it("marks a sitting submitted and links the attempt it produced", () => {
    const s = started();
    const res = closeSession({ sessionId: s.id, taker: ADA, attemptId: "at_1", now: T0 + 5 * 60_000 });
    expect(res.ok && res.session.status).toBe("submitted");
    expect(res.ok && res.session.attemptId).toBe("at_1");
    expect(res.ok && res.session.late).toBeUndefined();
    expect(openSessionFor(QUIZ, ADA)).toBeUndefined();
  });

  it("does not mark late inside the grace window", () => {
    // A slow submit is a network fact, not something the member did.
    const s = started();
    const res = closeSession({ sessionId: s.id, taker: ADA, now: T0 + LIMIT_MS + SUBMIT_GRACE_MS });
    expect(res.ok && res.session.late).toBeUndefined();
  });

  it("marks late once past the grace, and still ACCEPTS the submission", () => {
    const s = started();
    const res = closeSession({ sessionId: s.id, taker: ADA, now: T0 + LIMIT_MS + SUBMIT_GRACE_MS + 1 });
    expect(res.ok).toBe(true);
    expect(res.ok && res.session.late).toBe(true);
    expect(res.ok && res.session.status).toBe("submitted");
  });

  it("takes a final batch of flags and answers with the submission", () => {
    const s = started();
    recordBeat({ sessionId: s.id, taker: ADA, flags: [{ kind: "blur", at: 100 }], now: T0 + 15_000 });
    const res = closeSession({
      sessionId: s.id, taker: ADA,
      flags: [{ kind: "hidden", at: 200 }], answers: [1, 2],
      now: T0 + 60_000,
    });
    expect(res.ok && res.session.flags.map((f) => f.kind)).toEqual(["blur", "hidden"]);
    expect(res.ok && res.session.answers).toEqual([1, 2]);
  });

  it("refuses another member and an already-closed sitting", () => {
    const s = started();
    expect(closeSession({ sessionId: s.id, taker: LIAM, now: T0 })).toEqual({ ok: false, error: "forbidden" });
    closeSession({ sessionId: s.id, taker: ADA, now: T0 + 60_000 });
    expect(closeSession({ sessionId: s.id, taker: ADA, now: T0 + 90_000 })).toEqual({ ok: false, error: "closed" });
  });
});

describe("sweepStale", () => {
  it("leaves a sitting that is still legitimately running", () => {
    started();
    expect(sweepStale(T0 + 60_000)).toEqual([]);
    expect(openSessionFor(QUIZ, ADA)?.status).toBe("open");
  });

  it("leaves a sitting inside the grace window", () => {
    started();
    expect(sweepStale(T0 + LIMIT_MS + SUBMIT_GRACE_MS)).toEqual([]);
  });

  it("abandons a sitting nobody submitted, and hands back its answers", () => {
    // Walking away is currently free: no submission means no record at all.
    // The sweep returns the session so the caller can grade the last state.
    const s = started();
    recordBeat({ sessionId: s.id, taker: ADA, answers: [1, 0, -1], now: T0 + 60_000 });
    const swept = sweepStale(T0 + LIMIT_MS + SUBMIT_GRACE_MS + 1);
    expect(swept).toHaveLength(1);
    expect(swept[0].id).toBe(s.id);
    expect(swept[0].answers).toEqual([1, 0, -1]);
    expect(getSession(s.id)?.status).toBe("abandoned");
  });

  it("never sweeps the same sitting twice", () => {
    started();
    const late = T0 + LIMIT_MS + SUBMIT_GRACE_MS + 1;
    expect(sweepStale(late)).toHaveLength(1);
    expect(sweepStale(late + 60_000)).toEqual([]);
  });

  it("does not touch a sitting that was properly submitted", () => {
    const s = started();
    closeSession({ sessionId: s.id, taker: ADA, now: T0 + 60_000 });
    expect(sweepStale(T0 + LIMIT_MS + SUBMIT_GRACE_MS + 1)).toEqual([]);
    expect(getSession(s.id)?.status).toBe("submitted");
  });

  it("sweeps across members and quizzes in one pass", () => {
    started();
    started({ taker: LIAM });
    started({ quizId: "q_other" });
    expect(sweepStale(T0 + LIMIT_MS + SUBMIT_GRACE_MS + 1)).toHaveLength(3);
  });
});

describe("isPastGrace", () => {
  it("is false at the grace boundary and true one millisecond later", () => {
    const s = started();
    expect(isPastGrace(s, T0 + LIMIT_MS + SUBMIT_GRACE_MS)).toBe(false);
    expect(isPastGrace(s, T0 + LIMIT_MS + SUBMIT_GRACE_MS + 1)).toBe(true);
  });
});
