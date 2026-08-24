/**
 * The "To do" model: what a member still owes, grouped by how urgent it is.
 *
 * PRIORITY IS DERIVED, NEVER AUTHORED. Nothing in the data model carries a
 * priority field and none is invented here - urgency is computed from the due
 * date against a `now` the caller passes in. A derived urgency is honest: it can
 * be recomputed, explained from the data, and it moves on its own as a deadline
 * approaches. A hand-authored "High / Medium / Low" would be a claim nobody
 * maintains, drifting out of date the moment it was set, and everyone would
 * learn to ignore it. If a real priority is ever wanted it has to be a field
 * somebody owns and edits - not a label guessed at render time.
 *
 * PURE BY CONSTRUCTION. No fetch, no store reads, no React, and no `Date.now()`
 * - the clock arrives as an argument so a test can sit exactly on a boundary
 * instead of racing one. The only import is a type, which TypeScript erases:
 * lib/assignments reaches node:fs through the durable store, and importing a
 * VALUE from it would drag that whole chain into any client bundle that touched
 * this module. lib/quiz-history documents that failure; this file avoids it the
 * same way.
 *
 * Assembling the inputs (reading the stores, resolving what a member can see)
 * is the caller's job and is where the impurity belongs.
 */

// Type-only: erased at compile time, so no runtime edge to lib/assignments.
import type { Assignment } from "./assignments";

/** Buckets, most urgent first. This array is also the section order. */
export type TodoPriority = "overdue" | "soon" | "later" | "none";

/** "Soon" means due within a week, counting the boundary itself as soon. */
export const SOON_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export interface TodoItem {
  id: string;
  kind: "assignment" | "exam";
  title: string;
  href: string;
  dueAt: number | null;
  /** One short line of context - who assigned it, or why an exam still counts. */
  meta?: string;
}

export interface TodoSection {
  priority: TodoPriority;
  label: string;
  items: TodoItem[];
}

/**
 * An exam as the To-do list needs to see it.
 *
 * `countedAttempts` is the whole rule: zero means the member still owes this
 * exam. That covers "never sat it" and "sat it, and every attempt was voided"
 * with one number, which is right - a voided attempt is not a completed one,
 * and treating it as done would quietly excuse the member from work they have
 * not actually finished. Maps onto `counted` from lib/quiz-history.
 */
export interface TodoExam {
  quizId: string;
  title: string;
  /** Set only when a trainer assigned it with a date; a bare exam has none. */
  dueAt?: number | null;
  /** Sittings that count. Zero = outstanding. */
  countedAttempts: number;
  /** Sittings including voided ones. Display only - never decides outstanding. */
  totalAttempts?: number;
}

export interface BuildTodoInput {
  assignments: Assignment[];
  exams: TodoExam[];
  /** Unix ms. Passed in, never read from the clock - see the header. */
  now: number;
}

const ORDER: TodoPriority[] = ["overdue", "soon", "later", "none"];

const LABEL: Record<TodoPriority, string> = {
  overdue: "Overdue",
  soon: "Due this week",
  later: "Later",
  none: "No due date",
};

const KIND_LABEL: Record<Assignment["kind"], string> = {
  doc: "Document",
  deck: "Flashcards",
  quiz: "Quiz",
  module: "Module",
};

/**
 * Where a piece of assigned content lives.
 *
 * Mirrors `refHref` in components/use-assignments.ts rather than importing it:
 * that module is "use client", and a lib module must not depend on one. Four
 * lines of duplication is the cheaper of the two mistakes - if a route ever
 * moves, both need changing.
 */
function refHref(kind: Assignment["kind"], refId: string): string {
  if (kind === "doc") return `/view/${refId}`;
  if (kind === "deck") return `/decks/${refId}`;
  if (kind === "quiz") return `/quizzes/${refId}`;
  return `/modules/${refId}`;
}

/**
 * Which bucket a due date falls in.
 *
 * The boundaries, stated once so they are not re-guessed at each call site:
 *   - no due date        -> "none" (outstanding, but not urgent - it has no clock)
 *   - dueAt <  now       -> "overdue"; a date one millisecond past is already late
 *   - dueAt == now       -> "soon", NOT overdue. The moment a deadline arrives it
 *                           has not yet been missed, and rounding against the
 *                           member at the exact boundary is the wrong direction
 *                           to be wrong in.
 *   - within 7 days      -> "soon", inclusive of the seven-day mark itself
 *   - beyond that        -> "later"
 */
export function priorityFor(dueAt: number | null | undefined, now: number): TodoPriority {
  if (dueAt === null || dueAt === undefined) return "none";
  if (dueAt < now) return "overdue";
  return dueAt <= now + SOON_WINDOW_MS ? "soon" : "later";
}

/** An assignment is outstanding until the member marks it done. */
function outstandingAssignments(assignments: Assignment[]): Assignment[] {
  return assignments.filter((a) => a.status !== "done");
}

function assignmentItem(a: Assignment): TodoItem {
  const kindLabel = KIND_LABEL[a.kind] ?? "Item";
  return {
    id: a.id,
    kind: "assignment",
    title: a.title,
    href: refHref(a.kind, a.refId),
    dueAt: a.dueAt ?? null,
    meta: a.assignedByName ? `${kindLabel} · from ${a.assignedByName}` : kindLabel,
  };
}

function examItem(e: TodoExam): TodoItem {
  // A voided sitting is worth saying out loud: the member sat the exam and it
  // did not count, which reads as a mistake unless the list explains itself.
  const total = e.totalAttempts ?? 0;
  const meta =
    total > 0
      ? total === 1
        ? "Your attempt was voided"
        : `All ${total} attempts were voided`
      : "Not yet attempted";
  return {
    id: `exam:${e.quizId}`,
    kind: "exam",
    title: e.title,
    href: `/quizzes/${e.quizId}`,
    dueAt: e.dueAt ?? null,
    meta,
  };
}

/**
 * Most urgent first within a section, then by title.
 *
 * Sorting on the date rather than trusting input order means an overdue section
 * leads with what has been late longest. The title is a tiebreaker purely so the
 * output is deterministic - two items sharing a due date must not swap places
 * between runs, or the tests would be flaky for no reason.
 */
function byUrgency(a: TodoItem, b: TodoItem): number {
  if (a.dueAt !== b.dueAt) {
    if (a.dueAt === null) return 1;
    if (b.dueAt === null) return -1;
    return a.dueAt - b.dueAt;
  }
  return a.title.localeCompare(b.title);
}

/**
 * Everything a member still owes, grouped into sections by derived urgency.
 *
 * Sections come back in ORDER and an empty one is omitted entirely, so a member
 * with nothing overdue never sees an "Overdue" heading sitting above a blank
 * space - the presence of the heading is itself the signal.
 *
 * An exam that is ALSO covered by an open assignment appears once, as the
 * assignment. Both describe the same work, and the assignment is the better
 * record of it: it carries the due date and the name of whoever handed it out,
 * where the bare exam carries neither. (This case was not in the original
 * contract - flagged to panes 1 and 2 rather than decided silently.)
 */
export function buildTodo(input: BuildTodoInput): TodoSection[] {
  const { now } = input;
  const open = outstandingAssignments(input.assignments ?? []);

  // Quizzes already spoken for by an open assignment, so the exam list can skip
  // them instead of listing the same work twice.
  const assignedQuizIds = new Set(
    open.filter((a) => a.kind === "quiz").map((a) => a.refId),
  );

  const items: TodoItem[] = [
    ...open.map(assignmentItem),
    ...(input.exams ?? [])
      .filter((e) => e.countedAttempts === 0 && !assignedQuizIds.has(e.quizId))
      .map(examItem),
  ];

  const buckets = new Map<TodoPriority, TodoItem[]>();
  for (const item of items) {
    const p = priorityFor(item.dueAt, now);
    const list = buckets.get(p);
    if (list) list.push(item);
    else buckets.set(p, [item]);
  }

  const sections: TodoSection[] = [];
  for (const priority of ORDER) {
    const list = buckets.get(priority);
    if (!list || list.length === 0) continue;
    sections.push({ priority, label: LABEL[priority], items: list.sort(byUrgency) });
  }
  return sections;
}

/** Total outstanding items - the count a nav badge would show. */
export function todoCount(sections: TodoSection[]): number {
  return sections.reduce((n, s) => n + s.items.length, 0);
}
