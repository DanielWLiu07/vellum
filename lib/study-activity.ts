/**
 * What a member has actually studied.
 *
 * Vitals delivers content and, until now, remembered almost nothing about
 * learning. The one "I did this" in the whole system was completeAssignment,
 * which only exists if a trainer handed the work out - so a student who studies
 * on their own initiative left no trace, module progress lived in localStorage
 * (per browser, invisible to everyone), and closing the flashcard drill forgot
 * every card.
 *
 * Those are not four features. They are one fact recorded four times: THIS
 * MEMBER DID THIS THING WITH THIS CONTENT AT THIS TIME. This module stores that
 * fact and nothing else. Module progress, the deck's spaced-repetition
 * schedule, and the transcript are all folds over the same log - derived on
 * read, never stored, so they cannot drift apart from the events that produced
 * them or from each other.
 *
 * IDENTITY. Content is named by `kind` + `refId`, the exact pair
 * lib/assignments uses. An assignment and a study record pointing at the same
 * module say so in the same words, so the two join with no translation table.
 * `part` addresses a sub-unit within the content (a module subsection, one
 * flashcard) and its meaning is kind-specific.
 *
 * WHAT THIS DOES NOT DO. It never writes to lib/assignments. Studying an
 * assigned module does not complete the assignment - see the note on
 * `completed` below. Assignments may read study activity; study never writes
 * assignment state, so there is exactly one writer for "done".
 *
 * Demo-grade durable store like the others; a production build swaps in a DB
 * (and would materialise the folds below as indexed views rather than
 * recomputing them per request).
 */

import { persistMap } from "./durable";
import type { Card } from "./parse-cards";

/** The four content stores, named exactly as lib/assignments names them. */
export type StudyKind = "doc" | "deck" | "quiz" | "module";
const KINDS: readonly StudyKind[] = ["doc", "deck", "quiz", "module"];

/**
 * `viewed` - opened it. A "where was I" fact, not a history: only the most
 *   recent view of a given part is kept.
 * `completed` - the member said they finished this part. Their claim about
 *   this content, NOT about any assignment covering it.
 * `reviewed` - graded their own recall of one flashcard. Append-only, because
 *   the sequence of grades IS the spaced-repetition state (see reviewState).
 */
export type StudyAction = "viewed" | "completed" | "reviewed";
const ACTIONS: readonly StudyAction[] = ["viewed", "completed", "reviewed"];

/** Self-graded recall, four buttons wide. Maps onto SM-2's quality scale. */
export type StudyGrade = 0 | 1 | 2 | 3;
export const GRADE_FORGOT: StudyGrade = 0;
export const GRADE_HARD: StudyGrade = 1;
export const GRADE_GOOD: StudyGrade = 2;
export const GRADE_EASY: StudyGrade = 3;

export interface StudyEvent {
  id: string;
  /** The signed viewer's owner id. Never taken from a request parameter. */
  member: string;
  kind: StudyKind;
  /** Id within the store named by `kind`. Same field name as Assignment.refId. */
  refId: string;
  /**
   * Sub-unit within the content: a module subsection id, or a flashcard's
   * content key. Absent means the content as a whole (a doc, a quiz).
   */
  part?: string;
  action: StudyAction;
  at: number;
  /** `reviewed` only. */
  grade?: StudyGrade;
  /**
   * The content's title when the event was written. A transcript has to stay
   * readable after content is deleted; an id nobody can place is not a record
   * of anything. Resolved server-side from the content store, never from the
   * request body, so this can't become an unmoderated free-text channel.
   */
  title?: string;
}

export const ID_MAX = 128;
export const PART_MAX = 128;
export const TITLE_MAX = 120;
/**
 * Per-member cap. Eviction drops `viewed` rows first: a view is the cheapest
 * fact here, while `completed` and `reviewed` are the ones the folds below are
 * computed from - losing them would silently reset a member's progress or a
 * card's schedule.
 */
export const MAX_EVENTS_PER_MEMBER = 2000;

const g = globalThis as unknown as { __vitalsStudy?: Map<string, StudyEvent> };
const store: Map<string, StudyEvent> = (g.__vitalsStudy ??= new Map());
const { persist } = persistMap("study-activity", store);

const clamp = (s: unknown, n: number) => String(s ?? "").trim().slice(0, n);

export function isStudyKind(v: unknown): v is StudyKind {
  return KINDS.includes(v as StudyKind);
}
export function isStudyAction(v: unknown): v is StudyAction {
  return ACTIONS.includes(v as StudyAction);
}
/** A grade is only meaningful on a review, and only within the four buttons. */
export function normalizeGrade(raw: unknown): StudyGrade | undefined {
  const n = typeof raw === "number" ? raw : Number(raw);
  return n === 0 || n === 1 || n === 2 || n === 3 ? (n as StudyGrade) : undefined;
}

/**
 * The map key. `viewed` and `completed` upsert - one row per member, content
 * and part - so re-opening a subsection updates a timestamp instead of growing
 * the log forever. `reviewed` appends, because every grade changes the
 * schedule and the sequence is the state.
 *
 * Segments are encoded: an id containing the separator would otherwise let one
 * member's row collide with another's, and this key decides who owns a record.
 */
function keyFor(e: Pick<StudyEvent, "member" | "kind" | "refId" | "part" | "action">): string {
  if (e.action === "reviewed") return `sv_${crypto.randomUUID()}`;
  const seg = [e.member, e.kind, e.refId, e.part ?? "", e.action].map(encodeURIComponent);
  return seg.join("|");
}

export interface RecordStudyInput {
  member: string;
  kind: unknown;
  refId: unknown;
  part?: unknown;
  action: unknown;
  grade?: unknown;
  /** Resolved from the content store by the caller (the API layer). */
  title?: string;
  /** Injected so tests don't race the clock. */
  now?: number;
}

/**
 * Record one study fact. Returns null when the input doesn't describe one -
 * an unknown kind or action, a blank member or ref.
 *
 * A blank member records nothing rather than recording under "": a signed-out
 * viewer is `owner: ""` (NOBODY in lib/profile), and a shared bucket keyed on
 * the empty string would hand the next anonymous visitor someone else's
 * progress.
 */
export function recordStudy(input: RecordStudyInput): StudyEvent | null {
  const member = clamp(input.member, ID_MAX);
  const refId = clamp(input.refId, ID_MAX);
  if (!member || !refId) return null;
  if (!isStudyKind(input.kind) || !isStudyAction(input.action)) return null;

  const part = clamp(input.part, PART_MAX) || undefined;
  const grade = input.action === "reviewed" ? normalizeGrade(input.grade) : undefined;
  // A review with no grade is not a review - it carries no schedule information,
  // and storing it would append a row that every fold has to skip.
  if (input.action === "reviewed" && grade === undefined) return null;

  const at = Number.isFinite(input.now) ? (input.now as number) : Date.now();
  const key = keyFor({ member, kind: input.kind, refId, part, action: input.action });
  const title = clamp(input.title, TITLE_MAX) || undefined;
  const event: StudyEvent = {
    id: key,
    member,
    kind: input.kind,
    refId,
    ...(part ? { part } : {}),
    action: input.action,
    at,
    ...(grade !== undefined ? { grade } : {}),
    ...(title ? { title } : {}),
  };
  store.set(key, event);
  evictBeyondCap(member);
  persist();
  return event;
}

/**
 * Undo a completion (the module player's "mark not done" toggle). Deletes the
 * row rather than writing a "not done" event: absence already means not done,
 * and a second way to say it is a second thing to keep consistent.
 */
export function clearCompletion(member: string, kind: StudyKind, refId: string, part?: string): boolean {
  const key = keyFor({
    member: clamp(member, ID_MAX),
    kind,
    refId: clamp(refId, ID_MAX),
    part: clamp(part, PART_MAX) || undefined,
    action: "completed",
  });
  const existed = store.delete(key);
  if (existed) persist();
  return existed;
}

/** Trim one member's oldest rows, spending `viewed` before anything else. */
function evictBeyondCap(member: string): void {
  const mine = [...store.values()].filter((e) => e.member === member);
  let over = mine.length - MAX_EVENTS_PER_MEMBER;
  if (over <= 0) return;
  const byCheapestOldest = mine.sort(
    (a, b) => Number(a.action !== "viewed") - Number(b.action !== "viewed") || a.at - b.at,
  );
  for (const e of byCheapestOldest) {
    if (over-- <= 0) break;
    store.delete(e.id);
  }
}

/**
 * One member's events, newest first. Optionally narrowed to one piece of
 * content.
 *
 * A blank member matches nothing rather than everything - the same fail-closed
 * rule the write path uses.
 */
export function listStudy(
  member: string,
  filter?: { kind?: StudyKind; refId?: string; action?: StudyAction },
): StudyEvent[] {
  const who = clamp(member, ID_MAX);
  if (!who) return [];
  const refId = filter?.refId === undefined ? undefined : clamp(filter.refId, ID_MAX);
  return [...store.values()]
    .filter(
      (e) =>
        e.member === who &&
        (filter?.kind === undefined || e.kind === filter.kind) &&
        (refId === undefined || e.refId === refId) &&
        (filter?.action === undefined || e.action === filter.action),
    )
    .sort((a, b) => b.at - a.at);
}

/* --------------------------------------------------------- module progress */

export interface ModuleProgress {
  moduleId: string;
  /** Subsections that count toward the bar - the caller decides which exist. */
  total: number;
  completed: number;
  /** Subsection ids the member has ticked off, in module order. */
  completedParts: string[];
  percent: number;
  /**
   * Where to put them back. The last subsection they opened if it is still
   * unfinished, otherwise the first one they haven't done - resuming onto a
   * part they already completed is how "continue" starts feeling broken.
   */
  resumePart: string | null;
  lastStudiedAt: number | null;
}

/**
 * Fold a member's module events into a progress row.
 *
 * `subsectionIds` comes from the module itself rather than from the log: the
 * denominator has to be what the module contains TODAY, or deleting a
 * subsection would leave someone stuck at "7 of 8" forever. Events for parts
 * that no longer exist are ignored for the same reason.
 */
export function moduleProgress(member: string, moduleId: string, subsectionIds: readonly string[]): ModuleProgress {
  const events = listStudy(member, { kind: "module", refId: moduleId });
  const live = new Set(subsectionIds);
  const doneSet = new Set(
    events.filter((e) => e.action === "completed" && e.part && live.has(e.part)).map((e) => e.part as string),
  );
  const completedParts = subsectionIds.filter((id) => doneSet.has(id));
  const lastViewed = events.find((e) => e.action === "viewed" && e.part && live.has(e.part))?.part ?? null;
  const firstUndone = subsectionIds.find((id) => !doneSet.has(id)) ?? null;
  const total = subsectionIds.length;
  return {
    moduleId,
    total,
    completed: completedParts.length,
    completedParts,
    percent: total > 0 ? Math.round((completedParts.length / total) * 100) : 0,
    resumePart: lastViewed && !doneSet.has(lastViewed) ? lastViewed : firstUndone,
    lastStudiedAt: events.length ? events[0].at : null,
  };
}

/* ---------------------------------------------------- spaced repetition */

export interface ReviewState {
  /** SM-2 ease factor. Lower means the card comes back sooner. */
  ease: number;
  /** Days between the last review and the next. */
  intervalDays: number;
  /** Consecutive non-forgotten reviews; a lapse resets it. */
  reps: number;
  lapses: number;
  lastReviewedAt: number | null;
  /** Null means never reviewed, which counts as due. */
  dueAt: number | null;
}

export const NEW_CARD: ReviewState = {
  ease: 2.5,
  intervalDays: 0,
  reps: 0,
  lapses: 0,
  lastReviewedAt: null,
  dueAt: null,
};

export const MIN_EASE = 1.3;
export const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * One SM-2 step: the state after grading a card, given the state before it.
 *
 * Pure, with the clock injected, so the whole schedule is testable without a
 * DOM or a real Date - which matters because every interesting case here is
 * about what happens days from now.
 *
 * The deviations from textbook SM-2 are deliberate. Forgetting sends the card
 * back to today rather than to a one-day interval: the point of pressing
 * "forgot" is to see it again in this session, and a member who has to wait
 * until tomorrow to retry the card they just missed will stop pressing it
 * honestly. The ease floor stops a run of bad days from pinning a card at an
 * interval it can never climb out of.
 */
export function nextReview(prev: ReviewState, grade: StudyGrade, now: number): ReviewState {
  if (grade === GRADE_FORGOT) {
    return {
      ease: Math.max(MIN_EASE, prev.ease - 0.2),
      intervalDays: 0,
      reps: 0,
      lapses: prev.lapses + 1,
      lastReviewedAt: now,
      dueAt: now,
    };
  }
  const ease = Math.max(MIN_EASE, prev.ease + (grade === GRADE_HARD ? -0.15 : grade === GRADE_EASY ? 0.15 : 0));
  const reps = prev.reps + 1;
  // The classic 1-day / 6-day opening, then multiply. Rounding up keeps a card
  // from sticking on the same interval forever once ease sits near the floor.
  const intervalDays = reps === 1 ? 1 : reps === 2 ? 6 : Math.max(1, Math.ceil(prev.intervalDays * ease));
  return { ease, intervalDays, reps, lapses: prev.lapses, lastReviewedAt: now, dueAt: now + intervalDays * DAY_MS };
}

/**
 * Replay a card's grades into its current schedule.
 *
 * The schedule is DERIVED rather than stored. Storing ease and interval as
 * mutable fields would make them a second source of truth that can drift from
 * the reviews that produced them, and nothing could recompute one from the
 * other. Replaying is reproducible and self-healing; the cost is a fold per
 * card, which is why `reviewed` is the one action allowed to append.
 */
export function reviewState(grades: readonly { grade: StudyGrade; at: number }[]): ReviewState {
  return [...grades]
    .sort((a, b) => a.at - b.at)
    .reduce((state, g) => nextReview(state, g.grade, g.at), NEW_CARD);
}

/**
 * A flashcard's stable identity.
 *
 * Cards live in a positional array with no ids, and an index is not an
 * identity: reordering a deck, or inserting one card at the top, would silently
 * move every member's scheduling onto the wrong card. Hashing the prompt
 * survives reordering and duplication. Editing the front text does start the
 * card over, which is the honest answer - a different question is a different
 * thing to learn. A production schema gives cards real ids and this goes away.
 */
export function cardKey(card: Pick<Card, "front" | "frontImageId">): string {
  const seed = `${card.front.trim()} ${card.frontImageId ?? ""}`;
  // FNV-1a. Not security - just a short, stable, dependency-free digest.
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `c${h.toString(36)}`;
}

export interface CardSchedule {
  /** Position in the deck as it stands now - what the UI needs to show it. */
  index: number;
  key: string;
  state: ReviewState;
  due: boolean;
}

export interface DeckSchedule {
  deckId: string;
  total: number;
  /** Never reviewed. Counted apart from `due` so the UI can say "12 new". */
  unseen: number;
  due: number;
  /** Reviewed and not due yet - the ones spaced repetition is resting. */
  resting: number;
  /** When the soonest resting card comes back; null if none are resting. */
  nextDueAt: number | null;
  cards: CardSchedule[];
}

/**
 * A member's schedule for one deck, folded from their review history.
 *
 * Cards are supplied by the caller (from the deck store) rather than read out
 * of the log so the deck's CURRENT contents define the session: a card the
 * owner deleted stops being asked, and a card they added shows up as new
 * without anyone migrating anything.
 */
export function deckSchedule(
  member: string,
  deckId: string,
  cards: readonly Pick<Card, "front" | "frontImageId">[],
  now: number,
): DeckSchedule {
  const byKey = new Map<string, { grade: StudyGrade; at: number }[]>();
  for (const e of listStudy(member, { kind: "deck", refId: deckId, action: "reviewed" })) {
    if (!e.part || e.grade === undefined) continue;
    const list = byKey.get(e.part);
    if (list) list.push({ grade: e.grade, at: e.at });
    else byKey.set(e.part, [{ grade: e.grade, at: e.at }]);
  }

  const scheduled = cards.map((card, index) => {
    const key = cardKey(card);
    const grades = byKey.get(key);
    const state = grades ? reviewState(grades) : NEW_CARD;
    return { index, key, state, due: state.dueAt === null || state.dueAt <= now };
  });

  const resting = scheduled.filter((c) => !c.due);
  return {
    deckId,
    total: scheduled.length,
    unseen: scheduled.filter((c) => c.state.lastReviewedAt === null).length,
    due: scheduled.filter((c) => c.due).length,
    resting: resting.length,
    nextDueAt: resting.length ? Math.min(...resting.map((c) => c.state.dueAt as number)) : null,
    cards: scheduled,
  };
}

/* -------------------------------------------------------------- transcript */

export interface TranscriptEntry {
  kind: StudyKind;
  refId: string;
  title: string;
  /** The content is gone; `title` is a snapshot, not a live name. */
  removed: boolean;
  firstStudiedAt: number;
  lastStudiedAt: number;
  /** Distinct parts opened / completed, and total grades given. */
  partsViewed: number;
  partsCompleted: number;
  reviews: number;
  /** True once the member ticked the content itself off, not just a part. */
  completed: boolean;
}

export const REMOVED_TITLE = "Removed content";

/**
 * "What have I studied for Medical Terminology?" - grouped by content, most
 * recent first.
 *
 * Derived, never stored. A stored transcript is a third copy of facts that
 * already exist in the log, and the only thing a third copy reliably does is
 * disagree with the other two.
 *
 * `titleOf` is injected (the pattern lib/resource-list and lib/quiz-attempts
 * use) so this module stays a leaf and never reaches into the four content
 * stores. A live title wins because the member is looking for the thing as it
 * is named today; the snapshot is the fallback for content that no longer has
 * a today.
 */
export function transcript(
  member: string,
  titleOf: (kind: StudyKind, refId: string) => string | undefined = () => undefined,
): TranscriptEntry[] {
  const groups = new Map<string, StudyEvent[]>();
  for (const e of listStudy(member)) {
    const key = `${e.kind}|${encodeURIComponent(e.refId)}`;
    const list = groups.get(key);
    if (list) list.push(e);
    else groups.set(key, [e]);
  }

  const out: TranscriptEntry[] = [];
  for (const events of groups.values()) {
    const [head] = events; // listStudy is newest-first, so this is the latest
    const live = titleOf(head.kind, head.refId);
    const snapshot = events.find((e) => e.title)?.title;
    const parts = (action: StudyAction) =>
      new Set(events.filter((e) => e.action === action && e.part).map((e) => e.part)).size;
    out.push({
      kind: head.kind,
      refId: head.refId,
      title: live || snapshot || REMOVED_TITLE,
      removed: !live,
      firstStudiedAt: events[events.length - 1].at,
      lastStudiedAt: head.at,
      partsViewed: parts("viewed"),
      partsCompleted: parts("completed"),
      reviews: events.filter((e) => e.action === "reviewed").length,
      completed: events.some((e) => e.action === "completed" && !e.part),
    });
  }
  return out.sort((a, b) => b.lastStudiedAt - a.lastStudiedAt);
}

/** Test-only reset. */
export function __resetStudy(): void {
  store.clear();
}
