/**
 * Moderation review queue.
 *
 * Before this existed, flagged content was refused with a 422 and the bytes
 * were dropped — so an admin could see in the audit log that *something* was
 * blocked, but never what, and a false positive was unrecoverable for the user.
 *
 * The queue inverts that. Content that can't be cleared outright is still
 * stored, but held at `private` visibility and recorded here for a human to
 * approve or reject. Several different situations land in it, and the
 * distinction matters when reviewing:
 *
 *   flagged    the model tripped a category. Someone should look.
 *   unchecked  moderation was configured but did not actually run — the file
 *              was over a size cap, a page wouldn't render, or the API timed
 *              out. Previously these were indistinguishable from "clean"
 *              because a skipped result is `allowed: true`. Now they queue.
 *   reported   a member said this content is a problem. Unlike the two above,
 *              a reported entry does NOT hold the content private while it
 *              waits — see isQuarantined.
 *
 * Demo-grade in-memory (globalThis) + snapshot, like the other stores.
 */

import { persistMap } from "./durable";

/**
 * Why an item is waiting on a human.
 *
 *   flagged    the model tripped a category. Someone should look.
 *   unchecked  moderation was configured but did not run.
 *   submitted  nothing is wrong — a member is asking to publish to everyone,
 *              and public is an approval, not a self-serve setting (see
 *              lib/publish). Kept distinct from the other two so a reviewer
 *              reading the queue can tell "this needs judging" apart from
 *              "this needs suspecting".
 *   reported   a member pressed Report on something they can see. Distinct
 *              from `flagged` because the accusation came from a person, not a
 *              model: it carries someone's words and someone's name, and the
 *              reviewer is weighing the complaint as much as the content.
 *              Collapsing it into `flagged` would hide both.
 */
export type QueueReason = "flagged" | "unchecked" | "submitted" | "reported";
export type QueueStatus = "pending" | "approved" | "rejected";

/** What kind of thing is being held, for the reviewer's context. */
export type QueueKind =
  | "document"
  | "image"
  | "deck"
  | "quiz"
  | "module"
  | "comment"
  | "folder"
  | "profile";

export interface QueueEntry {
  id: string;
  /**
   * Monotonic insertion counter. Ordering can't key off `createdAt`: two items
   * enqueued in the same millisecond tie, and a tied sort is a flaky queue
   * order. Derived from the current max on every insert so it survives a
   * snapshot restore, where an in-process counter would restart at zero and
   * collide with everything already on disk.
   */
  seq: number;
  resourceId: string;
  kind: QueueKind;
  /** Who created it — the ban target if a reviewer decides it was deliberate. */
  owner: string;
  /** Display title, so the queue is readable without opening each item. */
  title: string;
  /** Categories the model tripped; empty for an `unchecked` hold. */
  categories: string[];
  reason: QueueReason;
  /** Why moderation didn't run, for `unchecked` holds (e.g. "over 8MB"). */
  detail?: string;
  /**
   * Who pressed Report, for `reported` entries. A reviewer needs it to weigh
   * the complaint (one member reporting a whole chapter's work reads very
   * differently from five members reporting one file) and to answer them.
   */
  reportedBy?: string;
  /**
   * The reporter's own words. Kept verbatim rather than mapped onto the model's
   * category list: "this is my sister's file, she didn't upload it" is not a
   * moderation category, and it is exactly the kind of thing only a person says.
   */
  reportReason?: string;
  /**
   * The visibility the creator asked for, restored verbatim on approval.
   *
   * Only meaningful for an entry that HELD the content (see holdsVisibility).
   * A `reported` entry never held anything, so there is nothing to restore and
   * this field must not be read for one: recording the scope a resource
   * happened to have at report time and replaying it on approval republishes
   * whatever the owner did in the meantime.
   */
  requestedVisibility: string;
  status: QueueStatus;
  createdAt: number;
  reviewedBy?: string;
  reviewedAt?: number;
  note?: string;
}

const g = globalThis as unknown as { __vitalsModQueue?: Map<string, QueueEntry> };
// entry id -> entry.
const store: Map<string, QueueEntry> = (g.__vitalsModQueue ??= new Map());
const { persist } = persistMap("moderation-queue", store);

let idCounter = 0;
function nextId(): string {
  idCounter += 1;
  return `mq_${Date.now().toString(36)}_${idCounter.toString(36)}`;
}

/** One past the highest seq in the store, so inserts stay ordered after restore. */
function nextSeq(): number {
  let max = 0;
  for (const e of store.values()) if (e.seq > max) max = e.seq;
  return max + 1;
}

export interface EnqueueInput {
  resourceId: string;
  kind: QueueKind;
  owner: string;
  title: string;
  reason: QueueReason;
  categories?: string[];
  detail?: string;
  reportedBy?: string;
  reportReason?: string;
  requestedVisibility?: string;
}

export function enqueue(input: EnqueueInput): QueueEntry {
  const entry: QueueEntry = {
    id: nextId(),
    seq: nextSeq(),
    resourceId: input.resourceId,
    kind: input.kind,
    owner: input.owner,
    title: input.title.slice(0, 200),
    categories: input.categories ?? [],
    reason: input.reason,
    ...(input.detail ? { detail: input.detail.slice(0, 200) } : {}),
    ...(input.reportedBy ? { reportedBy: input.reportedBy.slice(0, 60) } : {}),
    // Longer than `detail` and `note`: this is the whole substance of a report,
    // and a reviewer truncated mid-accusation has to guess the rest.
    ...(input.reportReason ? { reportReason: input.reportReason.slice(0, 1000) } : {}),
    requestedVisibility: input.requestedVisibility ?? "private",
    status: "pending",
    createdAt: Date.now(),
  };
  store.set(entry.id, entry);
  persist();
  return entry;
}

export function getEntry(id: string): QueueEntry | undefined {
  return store.get(id);
}

/** Pending items, oldest first — a review queue should drain FIFO. */
export function listPending(): QueueEntry[] {
  return [...store.values()]
    .filter((e) => e.status === "pending")
    .sort((a, b) => a.seq - b.seq);
}

/** Everything, newest first — the admin history view. */
export function listQueue(): QueueEntry[] {
  return [...store.values()].sort((a, b) => b.seq - a.seq);
}

/**
 * Whether an entry for this reason HELD the content private while it waited.
 *
 * Two questions turn on this and they have to give the same answer, which is
 * why they share one predicate: does a pending entry force the resource
 * private (below), and does approving it restore a visibility (the review
 * route). An entry that never held anything has nothing to release, so
 * "approve" on one must not write a scope — if these two ever disagreed, a
 * moderation decision would start moving content it never governed.
 *
 * Everything holds EXCEPT `reported`, and the exclusion is stated as "not
 * reported" rather than a list of holding reasons on purpose: a reason added
 * later defaults to holding, which errs toward showing a reviewer's decision
 * too much respect rather than too little.
 */
export function holdsVisibility(reason: QueueReason): boolean {
  return reason !== "reported";
}

/**
 * True while a resource has an UNRESOLVED hold. resource-share consults this
 * to keep a held resource private no matter what any route asks for, so an
 * item can't be shared out from under the review it is waiting on.
 *
 * A pending `reported` entry deliberately does NOT count. Everything else in
 * this queue got here because the platform itself couldn't clear the content;
 * a report got here because one member said so, and if that were enough to
 * force `private` then Report would be a takedown button any member could aim
 * at any other member's work. Whether a report is worth acting on is the
 * reviewer's call, and until they make it the content stays exactly as visible
 * as it was. The cost is real — a genuinely bad file stays up until someone
 * looks — and it is paid down by triage order (reported items are reviewed
 * first) rather than by handing out unilateral takedowns.
 */
export function isQuarantined(resourceId: string): boolean {
  for (const e of store.values()) {
    if (e.resourceId === resourceId && e.status === "pending" && holdsVisibility(e.reason)) return true;
  }
  return false;
}

/**
 * A member's still-open report on a resource, if they already filed one.
 *
 * Deliberately keyed on (resource, reporter) and not on the resource alone: a
 * SECOND member reporting the same file is new information — independent
 * corroboration is most of what tells a reviewer a report is real — so it gets
 * its own entry. The same member reporting twice is a double-click or a
 * frustrated retry, and stacking those buries the queue under one person.
 */
export function pendingReportBy(resourceId: string, reporter: string): QueueEntry | undefined {
  for (const e of store.values()) {
    if (
      e.resourceId === resourceId &&
      e.status === "pending" &&
      e.reason === "reported" &&
      e.reportedBy === reporter
    ) {
      return e;
    }
  }
  return undefined;
}

/**
 * The three things that can happen when a reviewer submits a decision.
 *
 * `already_decided` used to be indistinguishable from success: resolveEntry
 * returned the untouched existing entry, callers checked it for falsiness, and
 * a second reviewer's rejection of an already-approved item came back 200 with
 * an approved entry attached. The route then wrote "moderation.reject" to the
 * audit log for a rejection that never happened — in the one record a
 * moderation dispute is settled from. Carrying the existing entry along with
 * the failure lets the caller say WHO decided and WHAT they decided, which is
 * the only useful thing to tell the second reviewer.
 */
export type ResolveOutcome =
  | { ok: true; entry: QueueEntry }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "already_decided"; entry: QueueEntry };

/**
 * Record a reviewer's decision. Already-resolved entries are NOT re-resolved:
 * the first decision stands, so a double-submit can't overwrite who decided
 * and when.
 */
export function resolveEntry(
  id: string,
  status: Exclude<QueueStatus, "pending">,
  reviewedBy: string,
  note = "",
): ResolveOutcome {
  const entry = store.get(id);
  if (!entry) return { ok: false, reason: "not_found" };
  if (entry.status !== "pending") return { ok: false, reason: "already_decided", entry };
  const next: QueueEntry = {
    ...entry,
    status,
    reviewedBy,
    reviewedAt: Date.now(),
    ...(note ? { note: note.slice(0, 500) } : {}),
  };
  store.set(id, next);
  persist();
  return { ok: true, entry: next };
}

/**
 * Drop a resource's queue entries when the resource itself is deleted, and
 * return the ones that were still PENDING so the caller can record that
 * something under review has gone.
 *
 * Until this was wired into the delete routes, entries outlived their content:
 * the review queue kept offering a title that opened nothing (approving it
 * answered not_found), and isQuarantined stayed true for that id forever, so
 * the id could never be trusted again.
 *
 * DELETING SOMETHING UNDER REVIEW IS ALLOWED, AND RECORDED. A member removing
 * their own content while a reviewer is looking at it is a plausible way to
 * dodge moderation, and the tempting answer is to refuse the delete until the
 * queue drains. That answer is wrong here, twice over. A REPORTED resource is
 * deliberately still visible while it waits (see isQuarantined), so refusing
 * the delete would keep material somebody complained about in front of everyone
 * until a human got to it — the opposite of what the complaint asked for, and a
 * worse outcome than the "dodge". And the queue is drained by people, so a
 * block would strand a member's own file behind an unbounded wait on an
 * `unchecked` hold, which means nothing more than "nobody has looked yet".
 *
 * What the dodge would actually cost is the RECORD, not the bytes — the bytes
 * go either way once a delete is honoured. So the entries go and the audit log
 * keeps the fact. One deletion under review is unremarkable; a member with
 * several is the pattern that identifies someone gaming it, and a pattern is
 * the only thing this could ever have caught. The reporter's words are already
 * in the log from when the report was filed, so the deletion line doesn't
 * repeat them.
 *
 * Decided entries are dropped along with the pending ones. They are a
 * convenience view of decisions the audit log records permanently, and keeping
 * them would fill the reviewer's history with rows that open nothing.
 */
export function deleteQueueFor(resourceId: string): QueueEntry[] {
  const open: QueueEntry[] = [];
  let changed = false;
  for (const [id, e] of store) {
    if (e.resourceId !== resourceId) continue;
    if (e.status === "pending") open.push(e);
    store.delete(id);
    changed = true;
  }
  if (changed) persist();
  // Queue order, so a record of several open holds reads the way the reviewer
  // would have met them.
  return open.sort((a, b) => a.seq - b.seq);
}

/** How one open entry reads inside a deletion record. */
function describeEntry(e: QueueEntry): string {
  if (e.reason === "reported") return e.reportedBy ? `reported by ${e.reportedBy}` : "reported";
  if (e.reason === "flagged" && e.categories.length > 0) return `flagged: ${e.categories.join("/")}`;
  return e.reason;
}

/**
 * One line naming what a resource had open, for the audit entry its deletion
 * writes.
 *
 * WHO for a report and WHAT for a flag, because those are the two facts that
 * make a later pattern legible: three deletions under three different members'
 * reports is a very different story from three deletions of files that tripped
 * the same category, and "pending" alone tells neither.
 */
export function describeOpenReview(entries: readonly QueueEntry[]): string {
  return entries.map(describeEntry).join("; ");
}

/** Test-only: clear the queue. */
export function __resetModerationQueue(): void {
  store.clear();
  idCounter = 0;
}
