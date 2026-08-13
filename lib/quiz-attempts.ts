/**
 * Exam attempt records for quizzes in exam mode.
 *
 * A practice quiz records nothing - you take it, learn from misses, move on.
 * An EXAM (see ExamSettings in lib/quizzes) persists one attempt per submission:
 * the score, timing, and a timeline of advisory integrity flags the runner
 * captured (tab-switching, focus loss, fullscreen exit, copy/paste). This is
 * what the quiz owner reviews afterward.
 *
 * Integrity is deliberately demo-grade: flags are CLIENT-REPORTED, so a
 * determined taker can suppress them. The real proctored engine (server-enforced
 * deadlines, trustworthy lockdown) lives in the HOSA member platform. Auto-void
 * here flags the obvious cases; a human makes the final call via void/unvoid.
 *
 * Durable via the same snapshot layer as the other stores.
 */

import { isHydrated, persistMap } from "./durable";
// The wire shape and its wording live in ./quiz-history so the BROWSER can
// import them: this module owns the store, so it reaches node:fs, and a client
// component importing one value from here dragged that into the client bundle.
// Re-exported so server-side importers see no change.
import { changeLabel, type MyAttempt, type MyQuizHistory } from "./quiz-history";

export { changeLabel };
export type { MyAttempt, MyQuizHistory };

export type IntegrityKind = "hidden" | "blur" | "fullscreen-exit" | "copy" | "paste" | "contextmenu";

/** One integrity event, timestamped as ms elapsed since the attempt started. */
export interface IntegrityFlag {
  kind: IntegrityKind;
  at: number;
}

export interface QuizAttempt {
  id: string;
  quizId: string;
  taker: string;
  score: number;
  total: number;
  startedAt: number;
  submittedAt: number;
  durationSec: number;
  timeLimitSec: number;
  autoSubmitted: boolean;
  flags: IntegrityFlag[];
  voided: boolean;
  voidReason?: string;
  /**
   * The quiz's title as it read when the attempt was submitted. Optional
   * because attempts recorded before this field, and callers that don't pass
   * one, simply have none - the read path resolves a live title first and only
   * falls back to this.
   */
  quizTitle?: string;
}

const VALID_KINDS: readonly IntegrityKind[] = ["hidden", "blur", "fullscreen-exit", "copy", "paste", "contextmenu"];
/** Flags that suggest the taker left the exam surface (vs. an incidental copy). */
const SERIOUS_KINDS: readonly IntegrityKind[] = ["hidden", "blur", "fullscreen-exit"];
/** Auto-void once this many "serious" (left-the-surface) flags pile up. */
export const AUTO_VOID_THRESHOLD = 3;
const MAX_FLAGS = 500;
/** Keep at most this many attempts per quiz (bounds the store). */
const MAX_ATTEMPTS_PER_QUIZ = 200;
/** Matches the quiz title cap in lib/quizzes, so a snapshot is never truncated harder. */
const TITLE_MAX = 120;
/** Shown when a quiz is gone and the attempt carries no snapshot to fall back on. */
export const REMOVED_QUIZ_TITLE = "Removed quiz";

const g = globalThis as unknown as { __vitalsAttempts?: Map<string, QuizAttempt> };
const store: Map<string, QuizAttempt> = (g.__vitalsAttempts ??= new Map());
const { persist } = persistMap("quiz-attempts", store);

/** Keep only valid, well-formed flags; cap the count so one attempt can't bloat the store. */
function cleanFlags(raw: unknown): IntegrityFlag[] {
  if (!Array.isArray(raw)) return [];
  const out: IntegrityFlag[] = [];
  for (const f of raw) {
    const kind = (f as { kind?: unknown })?.kind;
    const at = (f as { at?: unknown })?.at;
    if (typeof kind === "string" && (VALID_KINDS as readonly string[]).includes(kind) && Number.isFinite(at)) {
      out.push({ kind: kind as IntegrityKind, at: Math.max(0, Math.round(at as number)) });
      if (out.length >= MAX_FLAGS) break;
    }
  }
  return out.sort((a, b) => a.at - b.at);
}

/** Count of "serious" flags - the ones that decide auto-void. */
export function seriousFlagCount(flags: IntegrityFlag[]): number {
  return flags.filter((f) => (SERIOUS_KINDS as readonly string[]).includes(f.kind)).length;
}

export interface RecordAttemptInput {
  quizId: string;
  taker: string;
  score: number;
  total: number;
  startedAt: number;
  timeLimitSec: number;
  autoSubmitted: boolean;
  flags: unknown;
  /** Title to snapshot; omit and the attempt keeps none (see QuizAttempt). */
  quizTitle?: string;
}

/** Persist one exam attempt, auto-voiding it if integrity flags cross the bar. */
export function recordAttempt(input: RecordAttemptInput): QuizAttempt {
  const flags = cleanFlags(input.flags);
  const submittedAt = Date.now();
  // Trust the server clock for duration, not the client's startedAt if it's in
  // the future or absurdly old; clamp to [0, timeLimit + 1 min grace].
  const rawStart = Number.isFinite(input.startedAt) ? input.startedAt : submittedAt;
  const startedAt = Math.min(submittedAt, Math.max(submittedAt - (input.timeLimitSec + 60) * 1000, rawStart));
  const durationSec = Math.round((submittedAt - startedAt) / 1000);
  const breached = seriousFlagCount(flags) >= AUTO_VOID_THRESHOLD;
  const quizTitle = (input.quizTitle ?? "").trim().slice(0, TITLE_MAX);
  const attempt: QuizAttempt = {
    id: `at_${crypto.randomUUID()}`,
    quizId: input.quizId,
    taker: input.taker,
    score: input.score,
    total: input.total,
    startedAt,
    submittedAt,
    durationSec,
    timeLimitSec: input.timeLimitSec,
    autoSubmitted: input.autoSubmitted,
    flags,
    voided: breached,
    ...(breached ? { voidReason: `Auto-voided: ${seriousFlagCount(flags)} integrity flags` } : {}),
    ...(quizTitle ? { quizTitle } : {}),
  };
  store.set(attempt.id, attempt);
  evictBeyondCap(input.quizId);
  if (isHydrated()) persist();
  return attempt;
}

/** Drop the oldest attempts for a quiz beyond the per-quiz cap. */
function evictBeyondCap(quizId: string): void {
  const mine = [...store.values()]
    .filter((a) => a.quizId === quizId)
    .sort((a, b) => a.submittedAt - b.submittedAt);
  while (mine.length > MAX_ATTEMPTS_PER_QUIZ) {
    const old = mine.shift();
    if (old) store.delete(old.id);
  }
}

/** Attempts for one quiz, newest first. */
export function listAttempts(quizId: string): QuizAttempt[] {
  return [...store.values()]
    .filter((a) => a.quizId === quizId)
    .sort((a, b) => b.submittedAt - a.submittedAt);
}

export function getAttempt(id: string): QuizAttempt | undefined {
  return store.get(id);
}

/** Manually void an attempt (owner/admin override); reason is trimmed + capped. */
export function voidAttempt(id: string, reason: string): QuizAttempt | undefined {
  const a = store.get(id);
  if (!a) return undefined;
  a.voided = true;
  a.voidReason = reason.trim().slice(0, 200) || "Voided";
  if (isHydrated()) persist();
  return a;
}

/** Reinstate an attempt an auto-void or human flagged (clears the void). */
export function unvoidAttempt(id: string): QuizAttempt | undefined {
  const a = store.get(id);
  if (!a) return undefined;
  a.voided = false;
  delete a.voidReason;
  if (isHydrated()) persist();
  return a;
}

/* ------------------------------------------------- the taker's own history */

/**
 * Every attempt by one taker, newest first.
 *
 * Scoped by taker rather than by quiz because the owner-only view is the wrong
 * shape for the person who sat the exam: /api/quizzes/[id]/attempts returns
 * EVERY member's scores for one quiz, which is why it is owner/admin-gated, and
 * that gate left students unable to see the results they earned.
 *
 * A blank taker matches nothing rather than everything. A signed-out viewer is
 * `owner: ""` (NOBODY, see lib/profile), and the one thing this lookup must
 * never do is answer an anonymous caller with other people's exams.
 */
export function listAttemptsByTaker(taker: string): QuizAttempt[] {
  if (!taker) return [];
  return [...store.values()]
    .filter((a) => a.taker === taker)
    .sort((a, b) => b.submittedAt - a.submittedAt);
}

/**
 * One attempt as its OWN taker may see it.
 *
 * Deliberately not a QuizAttempt: `flags` is gone. A taker must be told that an
 * attempt was voided and why - being silently zeroed with no explanation is the
 * failure this view exists to fix - but the flag-by-flag timeline is a
 * different thing. It is client-reported advisory telemetry that the owner
 * reads to make a judgement call, and returning it to the taker publishes which
 * signals are captured and exactly when, which is a suppression recipe for the
 * next sitting. The verdict is the taker's business; the evidence is the
 * reviewer's. `taker` is dropped too - it is always the person asking.
 */
/** One quiz's worth of a taker's attempts, plus how they moved across them. */
function percentOf(score: number, total: number): number {
  // A quiz can legitimately hold zero questions (the editor autosaves a draft),
  // so this would otherwise be NaN on the way to the browser.
  if (!Number.isFinite(total) || total <= 0) return 0;
  return Math.round((score / total) * 100);
}

function toMyAttempt(a: QuizAttempt): MyAttempt {
  return {
    id: a.id,
    quizId: a.quizId,
    score: a.score,
    total: a.total,
    percent: percentOf(a.score, a.total),
    submittedAt: a.submittedAt,
    durationSec: a.durationSec,
    timeLimitSec: a.timeLimitSec,
    autoSubmitted: a.autoSubmitted,
    voided: a.voided,
    ...(a.voidReason ? { voidReason: a.voidReason } : {}),
  };
}

/**
 * A taker's own attempts, grouped by quiz, newest activity first.
 *
 * Grouped rather than listed flat because two sittings of the same exam are a
 * trend and reading them as unrelated rows throws away the only thing the
 * history is for. Voided attempts stay visible but are excluded from best /
 * latest / change: an attempt that doesn't count must not quietly set a
 * personal best, and a student comparing against a score that was thrown out
 * would be measuring against nothing.
 *
 * `titleOf` is injected (the pattern lib/resource-list and lib/admin-stats use)
 * so this module stays a leaf and does not reach into the quiz store. Passing
 * the taker rather than a list of attempts is deliberate: there is no signature
 * here that can be handed somebody else's records by mistake.
 */
export function myQuizHistory(
  taker: string,
  titleOf: (quizId: string) => string | undefined,
): MyQuizHistory[] {
  const groups = new Map<string, QuizAttempt[]>();
  for (const a of listAttemptsByTaker(taker)) {
    const list = groups.get(a.quizId);
    if (list) list.push(a);
    else groups.set(a.quizId, [a]);
  }

  const out: MyQuizHistory[] = [];
  for (const [quizId, attempts] of groups) {
    // Prefer the live title: a student is looking for the quiz they can see in
    // the list today, so a rename should follow. The snapshot is the fallback
    // for the case with no "today" - the quiz was deleted, and an attempt
    // labelled by a bare id is a score nobody can place.
    const live = titleOf(quizId);
    const snapshot = attempts.find((a) => a.quizTitle)?.quizTitle;
    const counting = attempts.filter((a) => !a.voided);
    const percents = counting.map((a) => percentOf(a.score, a.total));
    out.push({
      quizId,
      title: live || snapshot || REMOVED_QUIZ_TITLE,
      removed: !live,
      attempts: attempts.map(toMyAttempt),
      counted: counting.length,
      voided: attempts.length - counting.length,
      bestPercent: percents.length ? Math.max(...percents) : null,
      latestPercent: percents.length ? percents[0] : null,
      // percents is newest-first, so [1] is the sitting before the latest one.
      changePercent: percents.length > 1 ? percents[0] - percents[1] : null,
    });
  }

  // Most recently attempted quiz first. Every group has at least one attempt,
  // and each group's list is already newest-first.
  return out.sort((a, b) => b.attempts[0].submittedAt - a.attempts[0].submittedAt);
}


/** Test-only reset. */
export function __resetAttempts(): void {
  store.clear();
}
