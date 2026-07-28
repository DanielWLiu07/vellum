/**
 * Buzzer game scoring - the "General skills" round-2 practice mode.
 *
 * A solo, timed buzz-in drill over an existing quiz's questions: the faster you
 * buzz and answer correctly, the more points. Pure functions here so the scoring
 * + summary are unit-testable independently of the React runner.
 */

/** Seconds on the clock for each question before it auto-expires. */
export const BUZZER_TIME_SEC = 15;
/** Points for a correct answer, before the speed bonus. */
export const BASE_POINTS = 100;
/** Extra points per whole second left on the clock when you locked in. */
export const SPEED_BONUS_PER_SEC = 10;

/**
 * Points for one question. Wrong answers and timeouts score zero; a correct
 * answer earns the base plus a speed bonus for the time remaining when locked in.
 * `secondsLeft` is clamped to [0, BUZZER_TIME_SEC] so a bad clock can't inflate.
 */
export function scoreQuestion(correct: boolean, secondsLeft: number): number {
  if (!correct) return 0;
  const clamped = Math.max(0, Math.min(BUZZER_TIME_SEC, Math.floor(secondsLeft)));
  return BASE_POINTS + clamped * SPEED_BONUS_PER_SEC;
}

export interface BuzzerSummary {
  /** Questions in the round. */
  total: number;
  /** How many were answered correctly. */
  correct: number;
  /** Total points earned. */
  points: number;
  /** Longest run of consecutive correct answers. */
  bestStreak: number;
  /** Correct / total as a 0-100 integer percentage (0 when total is 0). */
  accuracy: number;
}

/** One recorded outcome per question in play order. */
export interface BuzzerOutcome {
  correct: boolean;
  points: number;
}

/** Fold a round's per-question outcomes into a final summary. */
export function summarize(outcomes: BuzzerOutcome[]): BuzzerSummary {
  let correct = 0;
  let points = 0;
  let streak = 0;
  let bestStreak = 0;
  for (const o of outcomes) {
    points += o.points;
    if (o.correct) {
      correct += 1;
      streak += 1;
      if (streak > bestStreak) bestStreak = streak;
    } else {
      streak = 0;
    }
  }
  const total = outcomes.length;
  return { total, correct, points, bestStreak, accuracy: total ? Math.round((correct / total) * 100) : 0 };
}

/**
 * Return a shuffled copy of `items` using the Fisher-Yates algorithm. `rng`
 * defaults to Math.random but is injectable so tests can make it deterministic.
 */
export function shuffle<T>(items: readonly T[], rng: () => number = Math.random): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}
