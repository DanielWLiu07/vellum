import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AUTO_VOID_THRESHOLD,
  __resetAttempts,
  getAttempt,
  listAttempts,
  recordAttempt,
  seriousFlagCount,
  unvoidAttempt,
  voidAttempt,
  type IntegrityFlag,
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
