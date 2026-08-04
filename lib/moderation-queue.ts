/**
 * Moderation review queue.
 *
 * Before this existed, flagged content was refused with a 422 and the bytes
 * were dropped — so an admin could see in the audit log that *something* was
 * blocked, but never what, and a false positive was unrecoverable for the user.
 *
 * The queue inverts that. Content that can't be cleared outright is still
 * stored, but held at `private` visibility and recorded here for a human to
 * approve or reject. Two different situations land in it, and the distinction
 * matters when reviewing:
 *
 *   flagged    the model tripped a category. Someone should look.
 *   unchecked  moderation was configured but did not actually run — the file
 *              was over a size cap, a page wouldn't render, or the API timed
 *              out. Previously these were indistinguishable from "clean"
 *              because a skipped result is `allowed: true`. Now they queue.
 *
 * Demo-grade in-memory (globalThis) + snapshot, like the other stores.
 */

import { persistMap } from "./durable";

export type QueueReason = "flagged" | "unchecked";
export type QueueStatus = "pending" | "approved" | "rejected";

/** What kind of thing is being held, for the reviewer's context. */
export type QueueKind = "document" | "image" | "deck" | "quiz" | "comment" | "folder" | "profile";

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
  /** The visibility the creator asked for, restored verbatim on approval. */
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
 * True while a resource has an UNRESOLVED hold. resource-share consults this
 * to keep a held resource private no matter what any route asks for, so an
 * item can't be shared out from under the review it is waiting on.
 */
export function isQuarantined(resourceId: string): boolean {
  for (const e of store.values()) {
    if (e.resourceId === resourceId && e.status === "pending") return true;
  }
  return false;
}

/** Every entry for one resource, newest first. */
export function entriesForResource(resourceId: string): QueueEntry[] {
  return [...store.values()]
    .filter((e) => e.resourceId === resourceId)
    .sort((a, b) => b.seq - a.seq);
}

/**
 * Record a reviewer's decision. Returns the updated entry, or undefined if the
 * id is unknown. Already-resolved entries are NOT re-resolved: the first
 * decision stands, so a double-submit can't overwrite who decided and when.
 */
export function resolveEntry(
  id: string,
  status: Exclude<QueueStatus, "pending">,
  reviewedBy: string,
  note = "",
): QueueEntry | undefined {
  const entry = store.get(id);
  if (!entry || entry.status !== "pending") return entry;
  const next: QueueEntry = {
    ...entry,
    status,
    reviewedBy,
    reviewedAt: Date.now(),
    ...(note ? { note: note.slice(0, 500) } : {}),
  };
  store.set(id, next);
  persist();
  return next;
}

/** Drop a resource's queue entries (call when the resource itself is deleted). */
export function deleteQueueFor(resourceId: string): void {
  let changed = false;
  for (const [id, e] of store) {
    if (e.resourceId === resourceId) {
      store.delete(id);
      changed = true;
    }
  }
  if (changed) persist();
}

/** Test-only: clear the queue. */
export function __resetModerationQueue(): void {
  store.clear();
  idCounter = 0;
}
