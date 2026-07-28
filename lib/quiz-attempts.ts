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
}

const VALID_KINDS: readonly IntegrityKind[] = ["hidden", "blur", "fullscreen-exit", "copy", "paste", "contextmenu"];
/** Flags that suggest the taker left the exam surface (vs. an incidental copy). */
const SERIOUS_KINDS: readonly IntegrityKind[] = ["hidden", "blur", "fullscreen-exit"];
/** Auto-void once this many "serious" (left-the-surface) flags pile up. */
export const AUTO_VOID_THRESHOLD = 3;
const MAX_FLAGS = 500;
/** Keep at most this many attempts per quiz (bounds the store). */
const MAX_ATTEMPTS_PER_QUIZ = 200;

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

/** Test-only reset. */
export function __resetAttempts(): void {
  store.clear();
}
