/**
 * The browser half of study activity: how a component writes a study fact.
 *
 * Separate from lib/study-activity because that module owns the store and so
 * reaches lib/durable -> lib/persist -> node:fs. A client component importing
 * one VALUE from it drags that chain into the client bundle and the build
 * fails. Types are erased and stay safe to import from there; functions are
 * not, which is why these live here.
 *
 * Nothing in this file may import a store module. It is also deliberately thin:
 * the scheduler is not reimplemented here, because a second copy of "when does
 * this card come back" is a second answer waiting to disagree with the server's.
 * Components read schedules from /api/study/progress instead.
 */

import type { StudyGrade, StudyKind } from "./study-activity";

export interface StudyFact {
  kind: StudyKind;
  refId: string;
  /** Module subsection id, or the card key the schedule endpoint handed back. */
  part?: string;
  action: "viewed" | "completed" | "reviewed";
  grade?: StudyGrade;
}

/**
 * Record one fact, and never let it matter to the caller whether it worked.
 *
 * Writing progress must not block reading content: a member who opens a module
 * while the store is unreachable still gets their module, and the worst case is
 * a lost tick, not a lost lesson. So this resolves false instead of throwing,
 * and callers update their own state optimistically rather than waiting.
 *
 * No `title` is ever sent. The route resolves it server-side from the content
 * store and ignores a client-supplied one - a snapshot is only worth keeping if
 * it was trustworthy when taken.
 */
export async function recordStudy(fact: StudyFact): Promise<boolean> {
  const res = await fetch("/api/study", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(fact),
  }).catch(() => null);
  return Boolean(res?.ok);
}

/** Undo a completion. Same fire-and-forget contract as recordStudy. */
export async function clearStudy(fact: Pick<StudyFact, "kind" | "refId" | "part">): Promise<boolean> {
  const res = await fetch("/api/study/progress", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(fact),
  }).catch(() => null);
  return Boolean(res?.ok);
}

/** The four self-grading buttons, hardest first - the order Anki trained everyone on. */
export const GRADE_BUTTONS: { grade: StudyGrade; label: string; className: string }[] = [
  { grade: 0, label: "Forgot", className: "btn danger" },
  { grade: 1, label: "Hard", className: "btn" },
  { grade: 2, label: "Good", className: "btn primary" },
  { grade: 3, label: "Easy", className: "btn" },
];

/** "in 6 days" / "today" - how a next-review date reads to someone studying. */
export function dueLabel(dueAt: number | null, now: number = Date.now()): string {
  if (dueAt === null) return "new";
  const days = Math.round((dueAt - now) / (24 * 60 * 60 * 1000));
  if (days <= 0) return "today";
  if (days === 1) return "tomorrow";
  return `in ${days} days`;
}
