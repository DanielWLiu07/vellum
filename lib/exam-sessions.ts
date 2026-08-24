/**
 * Exam sessions - one sitting of one exam by one member, with the SERVER
 * owning the clock.
 *
 * Before this, everything that made a timed exam timed lived in the browser:
 * the runner stamped `startedAt` from its own `Date.now()` at mount and sent it
 * to /grade at submission, so a reload handed out a fresh clock, sitting past
 * the limit cost nothing, and closing the tab destroyed every integrity flag
 * because none had been sent anywhere. The server could only clamp the number
 * it was told.
 *
 * A session moves three facts across that boundary - when the sitting began,
 * when it ends, and what has been answered so far - and gives the browser a
 * reason to keep talking (see `recordBeat`). Two properties do most of the work:
 *
 *   - Opening is IDEMPOTENT per (quiz, taker) while a sitting is open, so a
 *     reload resumes the original deadline instead of minting a new one.
 *   - The runner beats every BEAT_INTERVAL_MS, so flags and progress are
 *     already on the server when a tab closes, and SILENCE becomes a signal
 *     rather than being indistinguishable from a clean exam.
 *
 * What this is NOT: a proctoring engine. It makes the sitting trustworthy -
 * when it ran, how long it took, what was answered, whether the taker left the
 * surface. It cannot tell anyone whether a person cheated, and nothing here
 * should be presented as if it could. Lockdown, camera and identity
 * verification stay out of Vitals (architecture spec §1).
 *
 * `now` is injectable throughout, the way lib/rate-limit does it, so a test can
 * sit exactly on a deadline instead of racing one.
 *
 * Demo-grade durable store like the others; a production build swaps in a DB.
 */

import { persistMap } from "./durable";
import { cleanFlags, type IntegrityFlag } from "./quiz-attempts";

export type ExamSessionStatus = "open" | "submitted" | "abandoned";

export interface ExamSession {
  id: string;
  quizId: string;
  /** The member sitting it. Only they may beat or submit against it. */
  taker: string;
  /** SERVER clock at open. Never a client-supplied time. */
  startedAt: number;
  /** startedAt + timeLimitSec * 1000, fixed at open and never extended. */
  deadline: number;
  /** Server clock at the last beat; silence past this is the signal. */
  lastBeatAt: number;
  /** Accumulated across beats, so a closed tab does not erase them. */
  flags: IntegrityFlag[];
  /** Progress so far; index per question, -1 for unanswered. */
  answers: number[];
  status: ExamSessionStatus;
  /** Set once the sitting has been graded. */
  attemptId?: string;
  /** Submitted past the deadline AND past the grace. */
  late?: boolean;
}

/**
 * Grace past the deadline before a submission counts as late.
 *
 * A submission is never REFUSED for being late - a dropped packet on submit
 * must not cost a student their entire exam - but inside this window it is not
 * even marked, because at that scale it is a network fact rather than anything
 * the member did.
 */
export const SUBMIT_GRACE_MS = 60_000;
/** How often the runner is expected to beat. */
export const BEAT_INTERVAL_MS = 15_000;
/** Bounds the answers array so one session cannot bloat the store. */
export const MAX_ANSWERS = 500;

const ID_MAX = 128;

const g = globalThis as unknown as { __vitalsExamSessions?: Map<string, ExamSession> };
const store: Map<string, ExamSession> = (g.__vitalsExamSessions ??= new Map());
const { persist } = persistMap("exam-sessions", store);

const clamp = (s: string, n: number) => String(s ?? "").trim().slice(0, n);

/**
 * Keep the answer array well-formed: whole numbers, -1 for unanswered, capped.
 * A client can send anything; this is the only place it is believed.
 */
function cleanAnswers(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, MAX_ANSWERS).map((v) => {
    // Reject the type BEFORE coercing. Number(null), Number(""), Number([])
    // and Number(false) are all 0 - which is a valid choice index - so a loose
    // Number(v) turns a question the member never answered into a selection of
    // the first option. Inventing an answer is far worse than dropping a
    // malformed one: it can mark a student wrong on a question they skipped.
    if (typeof v !== "number" && typeof v !== "string") return -1;
    if (typeof v === "string" && v.trim() === "") return -1;
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : -1;
  });
}

/** Seconds left on a sitting, never negative. Zero means the deadline passed. */
export function remainingSec(session: ExamSession, now: number = Date.now()): number {
  return Math.max(0, Math.ceil((session.deadline - now) / 1000));
}

/** Past the deadline AND the grace - the point where late is worth recording. */
export function isPastGrace(session: ExamSession, now: number = Date.now()): boolean {
  return now > session.deadline + SUBMIT_GRACE_MS;
}

export function getSession(id: string): ExamSession | undefined {
  return store.get(clamp(id, ID_MAX));
}

/** The member's currently-open sitting of a quiz, if there is one. */
export function openSessionFor(quizId: string, taker: string): ExamSession | undefined {
  const q = clamp(quizId, ID_MAX);
  const t = clamp(taker, ID_MAX);
  if (!q || !t) return undefined;
  for (const s of store.values()) {
    if (s.quizId === q && s.taker === t && s.status === "open") return s;
  }
  return undefined;
}

/** Every sitting of a quiz by one member, newest first - the retake count. */
export function sessionsFor(quizId: string, taker: string): ExamSession[] {
  const q = clamp(quizId, ID_MAX);
  const t = clamp(taker, ID_MAX);
  if (!q || !t) return [];
  return [...store.values()]
    .filter((s) => s.quizId === q && s.taker === t)
    .sort((a, b) => b.startedAt - a.startedAt);
}

export interface OpenSessionInput {
  quizId: string;
  taker: string;
  timeLimitSec: number;
  now?: number;
}

export type OpenSessionResult =
  | { ok: true; session: ExamSession; resumed: boolean }
  | { ok: false; error: "bad_request" };

/**
 * Start a sitting, or resume the one already open.
 *
 * Resuming rather than restarting is the whole point: a reload, a crashed tab
 * or a second window must not mint a new deadline, or the time limit means
 * nothing. The returned session carries the ORIGINAL startedAt and deadline,
 * and the answers recorded so far, so the runner can restore the member's
 * progress instead of making them begin again.
 */
export function openSession(input: OpenSessionInput): OpenSessionResult {
  const quizId = clamp(input.quizId, ID_MAX);
  const taker = clamp(input.taker, ID_MAX);
  const now = input.now ?? Date.now();
  if (!quizId || !taker) return { ok: false, error: "bad_request" };
  if (!Number.isFinite(input.timeLimitSec) || input.timeLimitSec <= 0) {
    return { ok: false, error: "bad_request" };
  }

  const existing = openSessionFor(quizId, taker);
  if (existing) return { ok: true, session: existing, resumed: true };

  const session: ExamSession = {
    id: `es_${crypto.randomUUID()}`,
    quizId,
    taker,
    startedAt: now,
    deadline: now + Math.floor(input.timeLimitSec) * 1000,
    lastBeatAt: now,
    flags: [],
    answers: [],
    status: "open",
  };
  store.set(session.id, session);
  persist();
  return { ok: true, session, resumed: false };
}

export type SessionError = "not_found" | "forbidden" | "closed";

export type BeatResult =
  | { ok: true; session: ExamSession; remainingSec: number }
  | { ok: false; error: SessionError };

export interface BeatInput {
  sessionId: string;
  /** Must match the session's taker - a session id is not a capability. */
  taker: string;
  flags?: unknown;
  answers?: unknown;
  now?: number;
}

/**
 * Record one heartbeat: the flags seen since the last beat, and the answers so
 * far.
 *
 * Flags ACCUMULATE and answers REPLACE, which is the difference between the two
 * kinds of fact. A flag is an event that happened and cannot un-happen; the
 * answer array is a current state, and the latest beat is simply the truest
 * version of it. Both are re-sanitised here rather than trusted.
 *
 * A beat past the deadline is still accepted while the session is open. The
 * clock is not enforced by refusing telemetry - refusing it would only delete
 * the record of what a taker did in overtime, which is the opposite of useful.
 */
export function recordBeat(input: BeatInput): BeatResult {
  const now = input.now ?? Date.now();
  const session = getSession(input.sessionId);
  if (!session) return { ok: false, error: "not_found" };
  if (session.taker !== clamp(input.taker, ID_MAX)) return { ok: false, error: "forbidden" };
  if (session.status !== "open") return { ok: false, error: "closed" };

  if (input.flags !== undefined) {
    const incoming = cleanFlags(input.flags);
    if (incoming.length) {
      session.flags = cleanFlags([...session.flags, ...incoming]);
    }
  }
  if (input.answers !== undefined) session.answers = cleanAnswers(input.answers);
  session.lastBeatAt = now;
  persist();
  return { ok: true, session, remainingSec: remainingSec(session, now) };
}

export type CloseResult =
  | { ok: true; session: ExamSession }
  | { ok: false; error: SessionError };

export interface CloseSessionInput {
  sessionId: string;
  taker: string;
  /** The attempt this sitting produced, so the two can be read together. */
  attemptId?: string;
  /** A final batch of flags from the submit itself. */
  flags?: unknown;
  answers?: unknown;
  now?: number;
}

/**
 * Finish a sitting.
 *
 * Late is recorded, never punished here: the submission is accepted whatever
 * the clock says and `late` is left for a human to weigh. Refusing a late
 * submission would mean a student whose upload stalled loses everything, which
 * is a far worse failure than one who ran over by a minute.
 */
export function closeSession(input: CloseSessionInput): CloseResult {
  const now = input.now ?? Date.now();
  const session = getSession(input.sessionId);
  if (!session) return { ok: false, error: "not_found" };
  if (session.taker !== clamp(input.taker, ID_MAX)) return { ok: false, error: "forbidden" };
  if (session.status !== "open") return { ok: false, error: "closed" };

  if (input.flags !== undefined) {
    const incoming = cleanFlags(input.flags);
    if (incoming.length) session.flags = cleanFlags([...session.flags, ...incoming]);
  }
  if (input.answers !== undefined) session.answers = cleanAnswers(input.answers);
  session.status = "submitted";
  session.lastBeatAt = now;
  if (isPastGrace(session, now)) session.late = true;
  if (input.attemptId) session.attemptId = clamp(input.attemptId, ID_MAX);
  persist();
  return { ok: true, session };
}

/**
 * Close out sittings nobody ever submitted.
 *
 * Vitals has no job runner, so this is called from a read path (a reviewer
 * opening the attempts list) the way the rest of the codebase computes on read.
 * It returns what it swept so the caller can record an attempt from each
 * session's last stored answers - which is the point. Today a member who
 * realises they are doing badly can simply close the tab and no record exists
 * at all; grading from the last beat makes walking away visible instead of free.
 *
 * Only sessions past the deadline AND the grace are swept, so a sitting still
 * legitimately in progress is never touched.
 */
export function sweepStale(now: number = Date.now()): ExamSession[] {
  const swept: ExamSession[] = [];
  for (const s of store.values()) {
    if (s.status === "open" && isPastGrace(s, now)) {
      s.status = "abandoned";
      swept.push(s);
    }
  }
  if (swept.length) persist();
  return swept;
}

/** Test-only: empty the store. */
export function __resetExamSessions(): void {
  store.clear();
}
