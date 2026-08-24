/**
 * Notifications - telling a member that something happened to them.
 *
 * This is architecture spec §13.1, the gap the doc calls the highest-impact in
 * the product: assignment works mechanically and tells nobody. A trainer hands
 * out work and the student learns about it only by opening Vitals and thinking
 * to check. Due dates pass in silence.
 *
 * A DESIGN WARNING, kept here because it is the thing most likely to be lost.
 * "Notify on every single thing" is what was asked for, and it is also exactly
 * how a notification system becomes noise that people train themselves to
 * ignore - at which point it is worse than nothing, because the one message
 * that mattered is now buried under forty that did not. Two rules push back on
 * that, and both are enforced HERE rather than left to call sites:
 *
 *   1. NEVER notify someone about their own action. `actor` is compared against
 *      `to` and the notification is dropped. A member who just ticked an
 *      assignment does not need to be told they ticked it. Doing this in the
 *      module means a new call site cannot forget it.
 *
 *   2. COLLAPSE what is honestly one event. Five assignments handed out in one
 *      go is ONE thing that happened to the student, not five. Notifications
 *      sharing a `groupKey`, still unread, inside COLLAPSE_WINDOW_MS merge into
 *      a single row with a count instead of stacking.
 *
 * Collapsing is only honest when the events really are one event. Two different
 * trainers assigning two different modules an hour apart are two things, and
 * should stay two rows - hence the window and the explicit key rather than
 * blanket deduplication by kind.
 *
 * Delivery is IN-APP ONLY. Vitals has no email (spec §1 non-goals: email lives
 * on the member platform), so this is a bell and a list, not a mailer. If email
 * is wanted later, this module is the seam it hangs off - one `notify()` call
 * already exists at every point worth sending from.
 *
 * Demo-grade durable store like the others; a production build swaps in a DB.
 */

import { persistMap } from "./durable";

export type NotificationKind =
  | "assignment.new"
  | "assignment.done"
  | "assignment.reopened"
  | "assignment.due_soon"
  | "assignment.overdue"
  | "attempt.voided"
  | "share.new"
  | "admin.broadcast";

export interface Notification {
  id: string;
  /** Recipient's member id. Only they may read or mark it. */
  to: string;
  kind: NotificationKind;
  title: string;
  body?: string;
  /** Where the member goes to act on it. */
  href?: string;
  /** How many events this row collapses; 1 unless grouped. */
  count: number;
  createdAt: number;
  /** Null until read. */
  readAt: number | null;
  /** Collapse key - see the header. Not shown to anyone. */
  groupKey?: string;
}

export const TITLE_MAX = 140;
export const BODY_MAX = 400;
export const HREF_MAX = 512;
const ID_MAX = 128;

/**
 * Cap per RECIPIENT, and eviction is per recipient too.
 *
 * Not per store: oldest-first eviction across everyone would mean one busy
 * member's notifications pushing out everybody else's - the same bug that made
 * quiz attempts deletable by flooding (see MAX_ATTEMPTS_PER_TAKER in
 * lib/quiz-attempts). One member can only ever evict their own.
 */
export const MAX_PER_RECIPIENT = 100;

/**
 * How long a like-for-like event stays collapsible.
 *
 * Long enough to absorb a trainer working through a roster one member at a
 * time; short enough that tomorrow's assignment is its own news.
 */
export const COLLAPSE_WINDOW_MS = 10 * 60 * 1000;

const g = globalThis as unknown as { __vitalsNotifications?: Map<string, Notification> };
const store: Map<string, Notification> = (g.__vitalsNotifications ??= new Map());
const { persist } = persistMap("notifications", store);

const clamp = (s: unknown, n: number) => String(s ?? "").trim().slice(0, n);

/**
 * Only same-origin app paths are storable as a destination.
 *
 * A notification is a link the member is invited to click, arriving from
 * somewhere they did not choose - so an absolute URL here would be an
 * open-redirect surface handed to whoever can raise one. Anything that is not a
 * plain internal path is dropped rather than sanitised.
 */
function cleanHref(raw: unknown): string | undefined {
  const href = clamp(raw, HREF_MAX);
  if (!href.startsWith("/") || href.startsWith("//")) return undefined;
  return href;
}

export interface NotifyInput {
  /** Recipient. */
  to: string;
  /** Who caused it. A notification is never delivered to its own actor. */
  actor?: string;
  kind: NotificationKind;
  title: string;
  body?: string;
  href?: string;
  /** Same key + unread + inside the window collapses into one row. */
  groupKey?: string;
  /** Title once collapsed; `{n}` becomes the count. Falls back to `title`. */
  groupTitle?: string;
  now?: number;
}

export type NotifyResult =
  | { delivered: true; notification: Notification; collapsed: boolean }
  | { delivered: false; reason: "self" | "bad_request" };

/**
 * Raise one notification.
 *
 * Returns `delivered: false` for the two cases that are outcomes rather than
 * failures: the actor is the recipient, or there is nothing addressable to
 * send. Callers should not treat either as an error - "no notification was
 * needed" is a correct result, and a call site that threw on it would end up
 * wrapped in a try/catch that hid real problems.
 */
export function notify(input: NotifyInput): NotifyResult {
  const to = clamp(input.to, ID_MAX);
  const title = clamp(input.title, TITLE_MAX);
  const now = input.now ?? Date.now();
  if (!to || !title) return { delivered: false, reason: "bad_request" };
  // Rule 1 from the header: you are never told about your own action.
  if (input.actor && clamp(input.actor, ID_MAX) === to) {
    return { delivered: false, reason: "self" };
  }

  const groupKey = input.groupKey ? clamp(input.groupKey, ID_MAX) : undefined;
  const body = input.body ? clamp(input.body, BODY_MAX) : undefined;
  const href = cleanHref(input.href);

  // Rule 2: collapse a like-for-like event the member has not read yet.
  if (groupKey) {
    const open = newestFirst(
      [...store.values()].filter(
        (n) =>
          n.to === to &&
          n.groupKey === groupKey &&
          n.readAt === null &&
          now - n.createdAt <= COLLAPSE_WINDOW_MS,
      ),
    )[0];
    if (open) {
      open.count += 1;
      open.createdAt = now; // it is news again; float it back to the top
      if (input.groupTitle) open.title = clamp(input.groupTitle.replace("{n}", String(open.count)), TITLE_MAX);
      // A collapsed row can no longer point at one specific thing.
      if (open.count > 1 && input.groupTitle) open.body = undefined;
      persist();
      return { delivered: true, notification: open, collapsed: true };
    }
  }

  const notification: Notification = {
    id: `nt_${crypto.randomUUID()}`,
    to,
    kind: input.kind,
    title,
    ...(body ? { body } : {}),
    ...(href ? { href } : {}),
    count: 1,
    createdAt: now,
    readAt: null,
    ...(groupKey ? { groupKey } : {}),
  };
  store.set(notification.id, notification);
  evictBeyondCap(to);
  persist();
  return { delivered: true, notification, collapsed: false };
}

/**
 * Drop one recipient's oldest notifications beyond the cap.
 *
 * Scoped to the recipient on purpose - see MAX_PER_RECIPIENT.
 */
function evictBeyondCap(to: string): void {
  const mine = [...store.values()]
    .filter((n) => n.to === to)
    .sort((a, b) => a.createdAt - b.createdAt);
  while (mine.length > MAX_PER_RECIPIENT) {
    const old = mine.shift();
    if (old) store.delete(old.id);
  }
}

/** Newest first; id breaks a tie so the order is stable within a millisecond. */
function newestFirst(items: Notification[]): Notification[] {
  return items.sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id));
}

/**
 * One member's notifications, newest first.
 *
 * A blank id matches nothing rather than everything: a signed-out viewer is
 * `owner: ""` (lib/profile), and the one thing this must never do is answer an
 * anonymous caller with somebody else's mail.
 */
export function listFor(userId: string, limit = MAX_PER_RECIPIENT): Notification[] {
  const id = clamp(userId, ID_MAX);
  if (!id) return [];
  return newestFirst([...store.values()].filter((n) => n.to === id)).slice(0, Math.max(0, limit));
}

/** How many are unread - the number on the bell. */
export function unreadCount(userId: string): number {
  const id = clamp(userId, ID_MAX);
  if (!id) return 0;
  let n = 0;
  for (const item of store.values()) if (item.to === id && item.readAt === null) n += 1;
  return n;
}

export type MarkResult =
  | { ok: true; notification: Notification }
  | { ok: false; error: "not_found" | "forbidden" };

/** Mark one read. Only the recipient may - a notification is not a shared object. */
export function markRead(id: string, userId: string, now: number = Date.now()): MarkResult {
  const item = store.get(clamp(id, ID_MAX));
  if (!item) return { ok: false, error: "not_found" };
  if (item.to !== clamp(userId, ID_MAX)) return { ok: false, error: "forbidden" };
  if (item.readAt === null) {
    item.readAt = now;
    persist();
  }
  return { ok: true, notification: item };
}

/** Mark every unread one read; returns how many changed. */
export function markAllRead(userId: string, now: number = Date.now()): number {
  const id = clamp(userId, ID_MAX);
  if (!id) return 0;
  let changed = 0;
  for (const item of store.values()) {
    if (item.to === id && item.readAt === null) {
      item.readAt = now;
      changed += 1;
    }
  }
  if (changed) persist();
  return changed;
}

/**
 * Has a notification with this groupKey EVER been raised for this recipient?
 *
 * Collapsing does not answer this and must not be made to. The two mechanisms
 * look similar and do different jobs: collapsing is about NOISE - merging a
 * burst of like events into one row - so it is deliberately scoped to an unread
 * row inside COLLAPSE_WINDOW_MS. Idempotence is about CORRECTNESS - never
 * raising the same fact twice - and has no window and no dependence on whether
 * the member read it. Widening the collapse window until it covered idempotence
 * would break collapsing instead: a genuinely new batch next week would merge
 * into a months-old row rather than being the news it is.
 *
 * So a due-date sweep that has no scheduler to lean on (Vitals has no cron -
 * everything is computed on read) asks THIS before raising, with a key naming
 * the exact fact: `due:<assignmentId>:soon`, `due:<assignmentId>:overdue`.
 *
 * One honest caveat: this reads the notification store, so if a row has been
 * evicted (MAX_PER_RECIPIENT) it answers false and the fact can be raised
 * again. That is the right behaviour rather than a hole - eviction means a
 * hundred newer notifications arrived and the member never acted on this one,
 * so an overdue assignment resurfacing is what should happen. It also avoids a
 * second, unbounded "already raised" ledger that could drift out of step with
 * what the member can actually see.
 */
export function hasRaised(to: string, groupKey: string): boolean {
  const id = clamp(to, ID_MAX);
  const key = clamp(groupKey, ID_MAX);
  if (!id || !key) return false;
  for (const n of store.values()) if (n.to === id && n.groupKey === key) return true;
  return false;
}

/** Test-only: empty the store. */
export function __resetNotifications(): void {
  store.clear();
}
