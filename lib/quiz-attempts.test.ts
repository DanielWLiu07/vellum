import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AUTO_VOID_THRESHOLD,
  REMOVED_QUIZ_TITLE,
  __resetAttempts,
  changeLabel,
  getAttempt,
  listAttempts,
  listAttemptsByTaker,
  myQuizHistory,
  recordAttempt,
  seriousFlagCount,
  unvoidAttempt,
  voidAttempt,
  type IntegrityFlag,
  type RecordAttemptInput,
} from "./quiz-attempts";

const base = {
  quizId: "q1",
  taker: "student_1",
  score: 3,
  total: 5,
  startedAt: Date.now() - 60_000,
  timeLimitSec: 600,
  autoSubmitted: false,
};

beforeEach(() => __resetAttempts());
afterEach(() => __resetAttempts());

describe("recordAttempt", () => {
  it("stores an attempt and returns it with a score + timing", () => {
    const a = recordAttempt({ ...base, flags: [] });
    expect(a.id).toMatch(/^at_/);
    expect(a.score).toBe(3);
    expect(a.total).toBe(5);
    expect(a.durationSec).toBeGreaterThanOrEqual(59);
    expect(a.voided).toBe(false);
    expect(getAttempt(a.id)).toEqual(a);
  });

  it("auto-voids when serious flags reach the threshold", () => {
    const flags: IntegrityFlag[] = Array.from({ length: AUTO_VOID_THRESHOLD }, (_, i) => ({ kind: "hidden", at: i * 1000 }));
    const a = recordAttempt({ ...base, flags });
    expect(a.voided).toBe(true);
    expect(a.voidReason).toMatch(/Auto-voided/);
  });

  it("does NOT auto-void below the threshold", () => {
    const flags: IntegrityFlag[] = Array.from({ length: AUTO_VOID_THRESHOLD - 1 }, (_, i) => ({ kind: "blur", at: i * 1000 }));
    expect(recordAttempt({ ...base, flags }).voided).toBe(false);
  });

  it("counts only serious flags toward auto-void (copy/paste/contextmenu don't)", () => {
    const flags: IntegrityFlag[] = [
      { kind: "copy", at: 1 },
      { kind: "paste", at: 2 },
      { kind: "contextmenu", at: 3 },
      { kind: "copy", at: 4 },
    ];
    const a = recordAttempt({ ...base, flags });
    expect(a.voided).toBe(false);
    expect(seriousFlagCount(a.flags)).toBe(0);
    expect(a.flags).toHaveLength(4);
  });

  it("drops malformed flags (bad kind, non-finite time)", () => {
    const a = recordAttempt({
      ...base,
      flags: [
        { kind: "hidden", at: 5 },
        { kind: "not-a-kind", at: 6 },
        { kind: "blur", at: Number.NaN },
        "garbage",
        { at: 7 },
      ],
    });
    expect(a.flags).toEqual([{ kind: "hidden", at: 5 }]);
  });

  it("sorts flags by time", () => {
    const a = recordAttempt({ ...base, flags: [{ kind: "blur", at: 30 }, { kind: "hidden", at: 10 }, { kind: "copy", at: 20 }] });
    expect(a.flags.map((f) => f.at)).toEqual([10, 20, 30]);
  });

  it("clamps a bogus future startedAt so duration is never negative", () => {
    const a = recordAttempt({ ...base, startedAt: Date.now() + 10 * 60_000, flags: [] });
    expect(a.durationSec).toBeGreaterThanOrEqual(0);
    expect(a.durationSec).toBeLessThanOrEqual(1);
  });
});

describe("listAttempts", () => {
  it("returns a quiz's attempts newest-first and excludes other quizzes", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(1_000_000));
      const older = recordAttempt({ ...base, startedAt: 1_000_000 - 60_000, flags: [] });
      vi.setSystemTime(new Date(2_000_000));
      const newer = recordAttempt({ ...base, startedAt: 2_000_000 - 60_000, flags: [] });
      recordAttempt({ ...base, quizId: "q2", startedAt: 2_000_000 - 60_000, flags: [] });
      const list = listAttempts("q1");
      expect(list.map((a) => a.id)).toEqual([newer.id, older.id]);
    } finally {
      vi.useRealTimers();
    }
  });
});

// The taker's own history. The owner-only route returns every member's scores
// for one quiz, so the person who sat the exam could not be shown their result
// through it; these cover the other direction - one member, every quiz.
describe("listAttemptsByTaker", () => {
  it("returns only that member's attempts, newest first", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(1_000_000));
      const older = recordAttempt({ ...base, flags: [] });
      vi.setSystemTime(new Date(2_000_000));
      const newer = recordAttempt({ ...base, quizId: "q2", flags: [] });
      const other = recordAttempt({ ...base, taker: "student_2", flags: [] });

      const mine = listAttemptsByTaker("student_1");
      expect(mine.map((a) => a.id)).toEqual([newer.id, older.id]);
      expect(mine.map((a) => a.id)).not.toContain(other.id);
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns nothing for a blank taker instead of everything", () => {
    // A signed-out viewer is `owner: ""` (NOBODY in lib/profile). Matching on it
    // loosely would hand an anonymous caller every exam in the store.
    recordAttempt({ ...base, flags: [] });
    expect(listAttemptsByTaker("")).toEqual([]);
    expect(listAttemptsByTaker("nobody_else")).toEqual([]);
  });
});

describe("myQuizHistory", () => {
  const titles = new Map<string, string>();
  const titleOf = (id: string) => titles.get(id);
  const history = (taker = "student_1") => myQuizHistory(taker, titleOf);

  /** Record at a fixed clock time so submission order is deterministic. */
  const at = (ms: number, patch: Partial<RecordAttemptInput> = {}) => {
    vi.setSystemTime(new Date(ms));
    return recordAttempt({ ...base, startedAt: ms - 60_000, flags: [], ...patch });
  };

  beforeEach(() => {
    titles.clear();
    titles.set("q1", "Cardiology basics");
    titles.set("q2", "Pharmacology");
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it("groups repeat sittings of one quiz into a single row, newest first", () => {
    // Two attempts at the same exam are a trend. Listed flat they read as two
    // unrelated scores, which throws away the only thing a history is for.
    at(1_000_000, { score: 2 });
    at(2_000_000, { score: 4 });

    const rows = history();
    expect(rows).toHaveLength(1);
    expect(rows[0].attempts.map((a) => a.score)).toEqual([4, 2]);
    expect(rows[0].title).toBe("Cardiology basics");
  });

  it("orders quizzes by most recent activity", () => {
    at(1_000_000, { quizId: "q1" });
    at(2_000_000, { quizId: "q2" });
    at(3_000_000, { quizId: "q1" });
    expect(history().map((r) => r.quizId)).toEqual(["q1", "q2"]);
  });

  it("never includes another member's attempts", () => {
    at(1_000_000, { taker: "student_2", quizId: "q1" });
    at(2_000_000, { taker: "student_1", quizId: "q1" });
    const rows = history();
    expect(rows[0].attempts).toHaveLength(1);
    expect(rows[0].attempts[0].score).toBe(base.score);
  });

  it("withholds the integrity timeline while still saying the attempt was voided", () => {
    // The line this view draws: a taker learns the verdict and the reason, but
    // not which signals were captured or when - that is the reviewer's evidence,
    // and handing it back is a recipe for suppressing it next time.
    const flags: IntegrityFlag[] = Array.from({ length: AUTO_VOID_THRESHOLD }, (_, i) => ({ kind: "hidden", at: i * 1000 }));
    at(1_000_000, { flags });

    const attempt = history()[0].attempts[0];
    expect(attempt).not.toHaveProperty("flags");
    expect(attempt).not.toHaveProperty("taker");
    expect(attempt.voided).toBe(true);
    expect(attempt.voidReason).toMatch(/Auto-voided/);
  });

  it("keeps a voided attempt visible but out of the score summary", () => {
    // A thrown-out attempt must not set a personal best, and a student
    // comparing against a score that doesn't count is measuring nothing.
    at(1_000_000, { score: 2 });
    const cheated = at(2_000_000, { score: 5 });
    voidAttempt(cheated.id, "Left the exam repeatedly");

    const row = history()[0];
    expect(row.attempts).toHaveLength(2);
    expect(row.counted).toBe(1);
    expect(row.voided).toBe(1);
    expect(row.bestPercent).toBe(40); // 2/5, not the voided 5/5
    expect(row.latestPercent).toBe(40);
    expect(row.changePercent).toBeNull(); // only one attempt still counts
    expect(row.attempts[0].voidReason).toBe("Left the exam repeatedly");
  });

  it("reports nulls, not zeros, when every attempt was voided", () => {
    // Zero would read as "you scored nothing"; the truth is there is no score.
    const a = at(1_000_000, { score: 4 });
    voidAttempt(a.id, "Voided by reviewer");
    const row = history()[0];
    expect(row.counted).toBe(0);
    expect(row.bestPercent).toBeNull();
    expect(row.latestPercent).toBeNull();
    expect(row.changePercent).toBeNull();
  });

  it("scores each attempt as a percentage so different-length quizzes compare", () => {
    at(1_000_000, { quizId: "q1", score: 3, total: 5 });
    at(2_000_000, { quizId: "q2", score: 15, total: 20 });
    const byQuiz = Object.fromEntries(history().map((r) => [r.quizId, r.latestPercent]));
    expect(byQuiz).toEqual({ q1: 60, q2: 75 });
  });

  it("scores an empty quiz as 0 rather than NaN", () => {
    // A quiz can hold zero questions - the editor autosaves a half-built draft -
    // and NaN would reach the browser as null or "NaN%".
    at(1_000_000, { score: 0, total: 0 });
    expect(history()[0].latestPercent).toBe(0);
  });

  it("reads improvement and decline from the last two counting attempts", () => {
    at(1_000_000, { score: 2 }); // 40%
    at(2_000_000, { score: 4 }); // 80%
    expect(history()[0].changePercent).toBe(40);

    at(3_000_000, { score: 3 }); // 60%
    expect(history()[0].changePercent).toBe(-20);
  });

  it("has no change to report on a first attempt", () => {
    at(1_000_000, { score: 3 });
    expect(history()[0].changePercent).toBeNull();
  });
});

describe("myQuizHistory when the quiz is gone", () => {
  const at = (ms: number, patch: Partial<RecordAttemptInput> = {}) => {
    vi.setSystemTime(new Date(ms));
    return recordAttempt({ ...base, startedAt: ms - 60_000, flags: [], ...patch });
  };
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("names a deleted quiz from the title snapshotted at submission", () => {
    // An attempt outlives the quiz it was against. Without the snapshot the
    // student is left with a score attached to an id they cannot place.
    at(1_000_000, { quizTitle: "Cardiology basics" });
    const row = myQuizHistory("student_1", () => undefined)[0];
    expect(row.title).toBe("Cardiology basics");
    expect(row.removed).toBe(true);
    expect(row.attempts[0].score).toBe(base.score);
  });

  it("falls back to a placeholder for an attempt recorded before snapshots existed", () => {
    // Degrades rather than breaking: the score, date and duration - everything
    // the student actually earned - survive; only the label is lost.
    at(1_000_000);
    const row = myQuizHistory("student_1", () => undefined)[0];
    expect(row.title).toBe(REMOVED_QUIZ_TITLE);
    expect(row.removed).toBe(true);
  });

  it("prefers the live title over the snapshot, so a rename follows", () => {
    // The student is hunting for the quiz as it is named in their list today.
    at(1_000_000, { quizTitle: "Old name" });
    const row = myQuizHistory("student_1", () => "New name")[0];
    expect(row.title).toBe("New name");
    expect(row.removed).toBe(false);
  });

  it("uses a snapshot from any sitting when only some carry one", () => {
    at(1_000_000, { quizTitle: "Cardiology basics" });
    at(2_000_000); // a later attempt recorded without one
    expect(myQuizHistory("student_1", () => undefined)[0].title).toBe("Cardiology basics");
  });
});

describe("changeLabel", () => {
  it("says nothing at all about a first attempt", () => {
    // "No change" would assert a comparison that was never made.
    expect(changeLabel(null)).toBeNull();
  });

  it("names the direction and reads points, not percent", () => {
    // The number is already the gap between two percentages; "up 40 percent"
    // would be read as a ratio of the old score.
    expect(changeLabel(40)).toBe("Up 40 points from your last attempt");
    expect(changeLabel(-20)).toBe("Down 20 points from your last attempt");
    expect(changeLabel(1)).toBe("Up 1 point from your last attempt");
    expect(changeLabel(0)).toBe("Same as your last attempt");
  });
});

describe("recordAttempt title snapshot", () => {
  it("stores a trimmed title and omits the field when none is given", () => {
    expect(recordAttempt({ ...base, flags: [], quizTitle: "  Cardiology basics  " }).quizTitle).toBe("Cardiology basics");
    expect(recordAttempt({ ...base, flags: [] }).quizTitle).toBeUndefined();
    // Whitespace is not a title; storing it would defeat the fallback chain.
    expect(recordAttempt({ ...base, flags: [], quizTitle: "   " }).quizTitle).toBeUndefined();
  });

  it("caps a title at the quiz store's own limit", () => {
    const a = recordAttempt({ ...base, flags: [], quizTitle: "t".repeat(400) });
    expect(a.quizTitle).toHaveLength(120);
  });
});

describe("void / unvoid", () => {
  it("voids with a reason then reinstates", () => {
    const a = recordAttempt({ ...base, flags: [] });
    const v = voidAttempt(a.id, "Left the exam repeatedly");
    expect(v?.voided).toBe(true);
    expect(v?.voidReason).toBe("Left the exam repeatedly");
    const u = unvoidAttempt(a.id);
    expect(u?.voided).toBe(false);
    expect(u?.voidReason).toBeUndefined();
  });

  it("returns undefined for an unknown attempt", () => {
    expect(voidAttempt("nope", "x")).toBeUndefined();
    expect(unvoidAttempt("nope")).toBeUndefined();
  });
});
