// Which due-date notifications are owed, and — just as important — which are
// not. Every case here is a clock case, so `now` is always explicit.

import { describe, expect, it } from "vitest";

import type { Assignment } from "./assignments";
import { dueGroupKey, dueRaises } from "./due-sweep";
import { SOON_WINDOW_MS } from "./todo";

const NOW = 1_800_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

const task = (over: Partial<Assignment> = {}): Assignment => ({
  id: "as_1",
  kind: "module",
  refId: "m1",
  title: "EMT Fundamentals",
  assigneeId: "s_ada",
  assignedBy: "t_1",
  assignedByName: "Coach Rivera",
  chapter: "Toronto Central",
  dueAt: NOW + DAY,
  status: "todo",
  createdAt: NOW - DAY,
  completedAt: null,
  ...over,
});

const nothingRaised = () => false;
const keys = (rs: ReturnType<typeof dueRaises>) => rs.map((r) => `${r.kind}:${r.assignment.id}`);

describe("what gets raised", () => {
  it("warns once when a deadline is inside the window", () => {
    expect(keys(dueRaises([task()], NOW, nothingRaised))).toEqual(["assignment.due_soon:as_1"]);
  });

  it("reports a deadline that has passed", () => {
    expect(keys(dueRaises([task({ dueAt: NOW - 1 })], NOW, nothingRaised))).toEqual(["assignment.overdue:as_1"]);
  });

  it("says nothing about a date a long way off", () => {
    expect(dueRaises([task({ dueAt: NOW + SOON_WINDOW_MS + 1 })], NOW, nothingRaised)).toEqual([]);
  });

  it("says nothing about work with no deadline", () => {
    expect(dueRaises([task({ dueAt: null })], NOW, nothingRaised)).toEqual([]);
  });

  it("says nothing about finished work, however late", () => {
    expect(dueRaises([task({ dueAt: NOW - 30 * DAY, status: "done" })], NOW, nothingRaised)).toEqual([]);
  });
});

describe("idempotence", () => {
  it("skips a stage already raised", () => {
    const raised = (k: string) => k === dueGroupKey("as_1", "assignment.due_soon");
    expect(dueRaises([task()], NOW, raised)).toEqual([]);
  });

  it("still raises overdue after due-soon was raised — that is new information", () => {
    const raised = (k: string) => k === dueGroupKey("as_1", "assignment.due_soon");
    expect(keys(dueRaises([task({ dueAt: NOW - 1 })], NOW, raised))).toEqual(["assignment.overdue:as_1"]);
  });

  it("never warns 'due soon' about a date that has already gone", () => {
    // Assigned with a past date, or nobody opened Vitals during the window.
    // A soon-warning here would arrive first and read as if there were time.
    const out = dueRaises([task({ dueAt: NOW - DAY })], NOW, nothingRaised);
    expect(keys(out)).toEqual(["assignment.overdue:as_1"]);
  });

  it("keys each assignment and stage separately", () => {
    expect(dueGroupKey("as_1", "assignment.due_soon")).toBe("due:as_1:soon");
    expect(dueGroupKey("as_1", "assignment.overdue")).toBe("due:as_1:overdue");
    expect(dueGroupKey("as_2", "assignment.overdue")).not.toBe(dueGroupKey("as_1", "assignment.overdue"));
  });
});

describe("boundaries and ordering", () => {
  it("treats a deadline arriving as soon, not overdue", () => {
    // Matches priorityFor: the moment a deadline arrives it has not been missed.
    expect(keys(dueRaises([task({ dueAt: NOW })], NOW, nothingRaised))).toEqual(["assignment.due_soon:as_1"]);
  });

  it("treats the far edge of the window as inside it", () => {
    expect(keys(dueRaises([task({ dueAt: NOW + SOON_WINDOW_MS })], NOW, nothingRaised)))
      .toEqual(["assignment.due_soon:as_1"]);
  });

  it("puts the most urgent first", () => {
    const out = dueRaises(
      [
        task({ id: "as_late", dueAt: NOW + 6 * DAY }),
        task({ id: "as_past", dueAt: NOW - 2 * DAY }),
        task({ id: "as_soon", dueAt: NOW + DAY }),
      ],
      NOW,
      nothingRaised,
    );
    expect(out.map((r) => r.assignment.id)).toEqual(["as_past", "as_soon", "as_late"]);
  });
});
