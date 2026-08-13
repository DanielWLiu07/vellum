/**
 * The shape a member's own exam history takes on the wire, plus the wording
 * that goes with it.
 *
 * Split out of lib/quiz-attempts because this half has to run in the BROWSER.
 * That module owns the store, so it reaches lib/durable -> lib/persist ->
 * node:fs; a client component importing one value from it drags the whole
 * chain into the client bundle and the build fails with "the chunking context
 * does not support external modules". Types alone would have been erased —
 * it was the one function that did it.
 *
 * So: no store access, no imports, nothing server-only. Anything added here
 * has to stay safe to run on both sides.
 */

export interface MyAttempt {
  id: string;
  quizId: string;
  score: number;
  total: number;
  /** 0-100. Precomputed so attempts on differently-sized quizzes compare. */
  percent: number;
  submittedAt: number;
  durationSec: number;
  timeLimitSec: number;
  autoSubmitted: boolean;
  voided: boolean;
  voidReason?: string;
}

export interface MyQuizHistory {
  quizId: string;
  title: string;
  /** The quiz is gone; `title` is a snapshot or a placeholder, not a live name. */
  removed: boolean;
  /** Newest first, voided ones included - a void is part of the history. */
  attempts: MyAttempt[];
  /** Attempts that count toward the summary, and those that don't. */
  counted: number;
  voided: number;
  /** Null when nothing counts: every attempt on this quiz was voided. */
  bestPercent: number | null;
  latestPercent: number | null;
  /** Percentage points between the last two counting attempts; null if only one. */
  changePercent: number | null;
}

/**
 * How the latest sitting compares with the one before it, in words.
 *
 * Null for a first attempt: there is nothing to compare against, and "no
 * change" would be a claim about a comparison that was never made. Points
 * rather than percent, because the number is already a difference between two
 * percentages and "up 40 percent" would be read as a ratio.
 */
export function changeLabel(changePercent: number | null): string | null {
  if (changePercent === null) return null;
  if (changePercent === 0) return "Same as your last attempt";
  const points = Math.abs(changePercent);
  const direction = changePercent > 0 ? "Up" : "Down";
  return `${direction} ${points} point${points === 1 ? "" : "s"} from your last attempt`;
}
