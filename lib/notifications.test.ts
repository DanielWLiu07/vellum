// Notifications (§13.1). The rules worth defending are the ones that keep this
// from becoming noise: nobody is told about their own action, one event is one
// row, and no member's mail can push out another's.

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  COLLAPSE_WINDOW_MS,
  MAX_PER_RECIPIENT,
  __resetNotifications,
  hasRaised,
  listFor,
  markAllRead,
  markRead,
  notify,
  unreadCount,
} from "./notifications";

const T0 = 1_800_000_000_000;
const ADA = "s_ada";
const LIAM = "s_liam";
const RIVERA = "t_rivera";

const send = (patch: Partial<Parameters<typeof notify>[0]> = {}) =>
  notify({ to: ADA, kind: "assignment.new", title: "New work", now: T0, ...patch });

/** Send and return the row, failing loudly if it wasn't delivered. */
const sent = (patch: Partial<Parameters<typeof notify>[0]> = {}) => {
  const res = send(patch);
  if (!res.delivered) throw new Error(`expected delivery, got ${res.reason}`);
  return res.notification;
};

beforeEach(() => __resetNotifications());
afterEach(() => __resetNotifications());

describe("notify", () => {
  it("stores a notification the recipient can read", () => {
    const n = sent({ body: "Airway Management", href: "/modules/m1" });
    expect(n.id).toMatch(/^nt_/);
    expect(n.count).toBe(1);
    expect(n.readAt).toBeNull();
    expect(listFor(ADA)).toEqual([n]);
    expect(unreadCount(ADA)).toBe(1);
  });

  it("NEVER notifies a member about their own action", () => {
    // The rule that stops the bell ringing at someone for something they just
    // did themselves. Enforced here so a new call site cannot forget it.
    const res = notify({ to: ADA, actor: ADA, kind: "assignment.done", title: "Done", now: T0 });
    expect(res).toEqual({ delivered: false, reason: "self" });
    expect(listFor(ADA)).toEqual([]);
  });

  it("still notifies when somebody else is the actor", () => {
    const res = notify({ to: ADA, actor: RIVERA, kind: "assignment.new", title: "New work", now: T0 });
    expect(res.delivered).toBe(true);
  });

  it("refuses a blank recipient or an empty title rather than storing junk", () => {
    expect(send({ to: "" })).toEqual({ delivered: false, reason: "bad_request" });
    expect(send({ title: "   " })).toEqual({ delivered: false, reason: "bad_request" });
  });

  it("keeps only same-origin paths as the destination", () => {
    // A notification is a link arriving from somewhere the member did not
    // choose; an absolute URL would be an open redirect handed to whoever can
    // raise one.
    expect(sent({ href: "/quizzes/q1" }).href).toBe("/quizzes/q1");
    expect(sent({ href: "https://evil.test/x" }).href).toBeUndefined();
    expect(sent({ href: "//evil.test/x" }).href).toBeUndefined();
    expect(sent({ href: "javascript:alert(1)" }).href).toBeUndefined();
  });

  it("truncates rather than storing unbounded text", () => {
    const n = sent({ title: "t".repeat(500), body: "b".repeat(900) });
    expect(n.title).toHaveLength(140);
    expect(n.body).toHaveLength(400);
  });
});

describe("collapsing - one event is one row", () => {
  it("collapses a batch handed out at once into a single counted row", () => {
    // Five assignments in one go is ONE thing that happened to the student.
    for (let i = 0; i < 5; i++) {
      send({ groupKey: "assign:t_rivera", groupTitle: "{n} new assignments", now: T0 + i * 1000 });
    }
    const list = listFor(ADA);
    expect(list).toHaveLength(1);
    expect(list[0].count).toBe(5);
    expect(list[0].title).toBe("5 new assignments");
    expect(unreadCount(ADA)).toBe(1);
  });

  it("reports whether a given call collapsed", () => {
    const first = send({ groupKey: "g" });
    const second = send({ groupKey: "g", now: T0 + 1000 });
    expect(first.delivered && first.collapsed).toBe(false);
    expect(second.delivered && second.collapsed).toBe(true);
  });

  it("does NOT collapse once the window has passed - tomorrow is its own news", () => {
    send({ groupKey: "g", now: T0 });
    send({ groupKey: "g", now: T0 + COLLAPSE_WINDOW_MS + 1 });
    expect(listFor(ADA)).toHaveLength(2);
  });

  it("does NOT collapse into a row the member has already read", () => {
    // Once they have seen it, the next event is new information.
    const first = sent({ groupKey: "g" });
    markRead(first.id, ADA, T0 + 100);
    send({ groupKey: "g", now: T0 + 200 });
    expect(listFor(ADA)).toHaveLength(2);
    expect(unreadCount(ADA)).toBe(1);
  });

  it("keeps different keys and different recipients apart", () => {
    send({ groupKey: "a" });
    send({ groupKey: "b" });
    send({ to: LIAM, groupKey: "a" });
    expect(listFor(ADA)).toHaveLength(2);
    expect(listFor(LIAM)).toHaveLength(1);
  });

  it("never collapses when no group key is given", () => {
    send();
    send({ now: T0 + 1000 });
    expect(listFor(ADA)).toHaveLength(2);
  });

  it("floats a collapsed row back to the top", () => {
    const older = sent({ groupKey: "g", title: "Grouped" });
    sent({ kind: "share.new", title: "Shared with you", now: T0 + 5000 });
    send({ groupKey: "g", groupTitle: "{n} new assignments", now: T0 + 9000 });
    expect(listFor(ADA)[0].id).toBe(older.id);
  });
});

describe("listFor / unreadCount", () => {
  it("returns newest first", () => {
    const a = sent({ title: "First", now: T0 });
    const b = sent({ title: "Second", now: T0 + 1000 });
    const c = sent({ title: "Third", now: T0 + 2000 });
    expect(listFor(ADA).map((n) => n.id)).toEqual([c.id, b.id, a.id]);
  });

  it("never leaks another member's mail, and answers a blank id with nothing", () => {
    send({ to: ADA });
    send({ to: LIAM });
    expect(listFor(ADA)).toHaveLength(1);
    // A signed-out viewer is owner:"" - it must not match everything.
    expect(listFor("")).toEqual([]);
    expect(unreadCount("")).toBe(0);
    expect(listFor("nobody")).toEqual([]);
  });

  it("honours a limit", () => {
    for (let i = 0; i < 10; i++) send({ now: T0 + i * 1000 });
    expect(listFor(ADA, 3)).toHaveLength(3);
  });

  it("counts only the unread ones, per member", () => {
    const a = sent();
    sent({ now: T0 + 1000 });
    send({ to: LIAM });
    markRead(a.id, ADA, T0 + 2000);
    expect(unreadCount(ADA)).toBe(1);
    expect(unreadCount(LIAM)).toBe(1);
  });
});

describe("markRead / markAllRead", () => {
  it("marks one read and is idempotent", () => {
    const n = sent();
    const first = markRead(n.id, ADA, T0 + 100);
    expect(first.ok && first.notification.readAt).toBe(T0 + 100);
    // A second call must not move the timestamp.
    const again = markRead(n.id, ADA, T0 + 999);
    expect(again.ok && again.notification.readAt).toBe(T0 + 100);
  });

  it("refuses another member - a notification is not a shared object", () => {
    const n = sent();
    expect(markRead(n.id, LIAM, T0)).toEqual({ ok: false, error: "forbidden" });
    expect(unreadCount(ADA)).toBe(1);
  });

  it("404s an id that does not exist", () => {
    expect(markRead("nt_nope", ADA, T0)).toEqual({ ok: false, error: "not_found" });
  });

  it("marks all of one member's unread, and nobody else's", () => {
    sent();
    sent({ now: T0 + 1000 });
    send({ to: LIAM });
    expect(markAllRead(ADA, T0 + 2000)).toBe(2);
    expect(unreadCount(ADA)).toBe(0);
    expect(unreadCount(LIAM)).toBe(1);
    // Nothing left to change the second time.
    expect(markAllRead(ADA, T0 + 3000)).toBe(0);
  });
});

describe("eviction is per recipient", () => {
  it("lets a flood evict only the flooded member's own notifications", () => {
    // The bug this repo already fixed once in quiz attempts: oldest-first
    // eviction across the whole store let one member's volume delete another's.
    const victim = sent({ to: LIAM, title: "Keep me" });
    for (let i = 0; i < MAX_PER_RECIPIENT + 40; i++) {
      send({ to: ADA, title: `n${i}`, now: T0 + i * 1000 });
    }
    expect(listFor(LIAM)).toHaveLength(1);
    expect(listFor(LIAM)[0].id).toBe(victim.id);
    expect(listFor(ADA).length).toBeLessThanOrEqual(MAX_PER_RECIPIENT);
  });

  it("drops the oldest of that member's own first", () => {
    const oldest = sent({ title: "oldest", now: T0 });
    for (let i = 1; i <= MAX_PER_RECIPIENT; i++) send({ title: `n${i}`, now: T0 + i * 1000 });
    expect(listFor(ADA).some((n) => n.id === oldest.id)).toBe(false);
    expect(listFor(ADA)).toHaveLength(MAX_PER_RECIPIENT);
  });
});

// Idempotence for the due-date sweep (there is no cron in Vitals, so the sweep
// runs on read and MUST NOT re-raise a fact it already raised). Deliberately
// separate from collapsing: different job, different rules.
describe("hasRaised", () => {
  it("reports whether a key was ever raised for that recipient", () => {
    expect(hasRaised(ADA, "due:as_1:overdue")).toBe(false);
    send({ groupKey: "due:as_1:overdue" });
    expect(hasRaised(ADA, "due:as_1:overdue")).toBe(true);
  });

  it("stays true once the member has read it - unlike collapsing", () => {
    // The case that makes this a separate function: a read row no longer
    // collapses, but the fact has still been raised and must not repeat.
    const n = sent({ groupKey: "due:as_1:soon" });
    markRead(n.id, ADA, T0 + 100);
    expect(hasRaised(ADA, "due:as_1:soon")).toBe(true);
  });

  it("stays true long past the collapse window", () => {
    send({ groupKey: "due:as_1:soon", now: T0 });
    // An hour later the row would no longer collapse, but it was still raised.
    expect(hasRaised(ADA, "due:as_1:soon")).toBe(true);
  });

  it("is scoped per recipient and per key", () => {
    send({ to: ADA, groupKey: "due:as_1:soon" });
    expect(hasRaised(LIAM, "due:as_1:soon")).toBe(false);
    expect(hasRaised(ADA, "due:as_1:overdue")).toBe(false);
    expect(hasRaised(ADA, "due:as_2:soon")).toBe(false);
  });

  it("answers false for a blank recipient or key rather than matching loosely", () => {
    send({ groupKey: "due:as_1:soon" });
    expect(hasRaised("", "due:as_1:soon")).toBe(false);
    expect(hasRaised(ADA, "")).toBe(false);
  });
});
