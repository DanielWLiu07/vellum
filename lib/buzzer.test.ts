import { describe, expect, it } from "vitest";

import {
  BASE_POINTS,
  BUZZER_TIME_SEC,
  SPEED_BONUS_PER_SEC,
  scoreQuestion,
  shuffle,
  summarize,
  type BuzzerOutcome,
} from "./buzzer";

describe("scoreQuestion", () => {
  it("scores zero for a wrong answer regardless of speed", () => {
    expect(scoreQuestion(false, BUZZER_TIME_SEC)).toBe(0);
  });

  it("awards base + speed bonus for a fast correct answer", () => {
    expect(scoreQuestion(true, 10)).toBe(BASE_POINTS + 10 * SPEED_BONUS_PER_SEC);
  });

  it("awards just the base when the clock is at zero", () => {
    expect(scoreQuestion(true, 0)).toBe(BASE_POINTS);
  });

  it("clamps an out-of-range clock so it can't inflate the score", () => {
    expect(scoreQuestion(true, 999)).toBe(BASE_POINTS + BUZZER_TIME_SEC * SPEED_BONUS_PER_SEC);
    expect(scoreQuestion(true, -5)).toBe(BASE_POINTS);
  });

  it("floors fractional seconds", () => {
    expect(scoreQuestion(true, 5.9)).toBe(BASE_POINTS + 5 * SPEED_BONUS_PER_SEC);
  });
});

describe("summarize", () => {
  const O = (correct: boolean, points = 0): BuzzerOutcome => ({ correct, points });

  it("counts correct, sums points, and computes accuracy", () => {
    const s = summarize([O(true, 150), O(false), O(true, 120), O(true, 100)]);
    expect(s.total).toBe(4);
    expect(s.correct).toBe(3);
    expect(s.points).toBe(370);
    expect(s.accuracy).toBe(75);
  });

  it("tracks the longest streak, not the last", () => {
    const s = summarize([O(true), O(true), O(true), O(false), O(true)]);
    expect(s.bestStreak).toBe(3);
  });

  it("handles an empty round without dividing by zero", () => {
    expect(summarize([])).toEqual({ total: 0, correct: 0, points: 0, bestStreak: 0, accuracy: 0 });
  });
});

describe("shuffle", () => {
  it("returns a permutation without mutating the input", () => {
    const src = [1, 2, 3, 4, 5];
    const out = shuffle(src, () => 0.5);
    expect(out).toHaveLength(5);
    expect([...out].sort()).toEqual([1, 2, 3, 4, 5]);
    expect(src).toEqual([1, 2, 3, 4, 5]); // input untouched
  });

  it("is deterministic given a fixed rng", () => {
    const rng = () => 0;
    expect(shuffle([1, 2, 3], rng)).toEqual(shuffle([1, 2, 3], rng));
  });
});
