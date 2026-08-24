// Which due-date notifications are owed right now.
//
// Vitals has no scheduler. There is no cron, no worker, no setInterval
// anywhere in the repo, and the store is single-instance (§4.2) - so nothing
// has ever acted on a `dueAt`. A trainer could set a due date and the date
// would pass in silence, which made due dates decorative.
//
// Rather than pretend to have a scheduler, this sweeps LAZILY: whenever a
// member's own work is read, we work out what should have fired by now and
// fire it. A member who never opens Vitals gets no notification, which is
// honest - there is nowhere to deliver it to anyway until email exists (§13.1)
// - and a member who does open it sees the same set they would have.
//
// Pure, and idempotence is INJECTED as `raised`. Deciding "have we already
// told them this?" needs storage; deciding "should they be told?" does not,
// and keeping the two apart is what lets every rule below be unit-tested
// against a clock we control.

import type { Assignment } from "./assignments";
import { priorityFor } from "./todo";

export type DueKind = "assignment.due_soon" | "assignment.overdue";

export interface DueRaise {
  assignment: Assignment;
  kind: DueKind;
  /** Stable per assignment AND stage, so each fires at most once. */
  groupKey: string;
}

/** The key a raise is remembered under. Exported so callers record the same one. */
export function dueGroupKey(assignmentId: string, kind: DueKind): string {
  return `due:${assignmentId}:${kind === "assignment.overdue" ? "overdue" : "soon"}`;
}

/**
 * What to raise for this member, given the clock and what has been raised
 * before. `raised(groupKey)` answers "already told them"; anything it returns
 * true for is skipped.
 *
 * Stages are independent on purpose. An assignment that warned "due soon" and
 * then went past its date raises the overdue one too - that is new information,
 * not a repeat. An assignment created ALREADY overdue raises only the overdue
 * one: a "due soon" warning for a date that has gone is noise, and worse, it
 * would arrive first and read as if there were still time.
 */
export function dueRaises(
  assignments: Assignment[],
  now: number,
  raised: (groupKey: string) => boolean,
): DueRaise[] {
  const out: DueRaise[] = [];
  for (const a of assignments) {
    // Finished work has no deadline left to miss.
    if (a.status === "done") continue;
    const priority = priorityFor(a.dueAt, now);
    if (priority === "overdue") {
      const key = dueGroupKey(a.id, "assignment.overdue");
      if (!raised(key)) out.push({ assignment: a, kind: "assignment.overdue", groupKey: key });
      continue;
    }
    if (priority === "soon") {
      const key = dueGroupKey(a.id, "assignment.due_soon");
      if (!raised(key)) out.push({ assignment: a, kind: "assignment.due_soon", groupKey: key });
    }
    // "later" and "none" are not events. A date a week out is not news, and a
    // date that does not exist never arrives.
  }
  // Soonest deadline first: if several land at once, the most urgent is the one
  // they should read at the top.
  return out.sort((x, y) => (x.assignment.dueAt ?? 0) - (y.assignment.dueAt ?? 0));
}
