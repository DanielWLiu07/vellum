// The To-do model. Every case here fixes a clock explicitly: `now` is an
// argument to buildTodo precisely so a test can sit ON a boundary rather than
// near one, and a test that called Date.now() would give that up.

import { describe, expect, it } from "vitest";

import type { Assignment } from "./assignments";
import {
  SOON_WINDOW_MS,
  type TodoExam,
  buildTodo,
  priorityFor,
  todoCount,
} from "./todo";

const NOW = 1_800_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

/** An open assignment; override anything the case cares about. */
const assignment = (patch: Partial<Assignment> = {}): Assignment => ({
  id: "as_1",
  kind: "module",
  refId: "m_airway",
  title: "Airway Management",
  assigneeId: "s_ada",
  assignedBy: "t_rivera",
  assignedByName: "Coach Rivera",
  chapter: "Toronto Central",
  dueAt: null,
  status: "todo",
  createdAt: NOW - DAY,
  completedAt: null,
  ...patch,
});

const exam = (patch: Partial<TodoExam> = {}): TodoExam => ({
  quizId: "q_cardio",
  title: "Cardiology basics",
  countedAttempts: 0,
  ...patch,
});

const build = (patch: Partial<Parameters<typeof buildTodo>[0]> = {}) =>
  buildTodo({ assignments: [], exams: [], now: NOW, ...patch });

/** Flatten to "priority: title" pairs - the shape assertions read best against. */
const flatten = (sections: ReturnType<typeof buildTodo>) =>
  sections.flatMap((s) => s.items.map((i) => `${s.priority}: ${i.title}`));

describe("priorityFor - the boundaries", () => {
  it("treats a date one millisecond in the past as overdue", () => {
    expect(priorityFor(NOW - 1, NOW)).toBe("overdue");
  });

  it("treats exactly-now as soon, not overdue", () => {
    // The instant a deadline arrives it has not yet been missed. At the exact
    // boundary the rounding has to go the member's way.
    expect(priorityFor(NOW, NOW)).toBe("soon");
  });

  it("treats exactly seven days out as soon, and a millisecond later as later", () => {
    expect(priorityFor(NOW + SOON_WINDOW_MS, NOW)).toBe("soon");
    expect(priorityFor(NOW + SOON_WINDOW_MS + 1, NOW)).toBe("later");
  });

  it("puts a missing due date in its own bucket rather than guessing", () => {
    expect(priorityFor(null, NOW)).toBe("none");
    expect(priorityFor(undefined, NOW)).toBe("none");
  });
});

describe("buildTodo - sections", () => {
  it("returns sections in priority order and omits the empty ones", () => {
    const sections = build({
      assignments: [
        assignment({ id: "as_late", title: "Late", dueAt: NOW - DAY }),
        assignment({ id: "as_none", title: "Undated", dueAt: null }),
        assignment({ id: "as_soon", title: "Soon", dueAt: NOW + DAY }),
      ],
    });
    // No "later" item exists, so no "Later" heading comes back - the presence
    // of a heading is itself the signal.
    expect(sections.map((s) => s.priority)).toEqual(["overdue", "soon", "none"]);
    expect(sections.map((s) => s.label)).toEqual(["Overdue", "Due this week", "No due date"]);
  });

  it("returns nothing at all when there is nothing outstanding", () => {
    expect(build()).toEqual([]);
    expect(todoCount(build())).toBe(0);
  });

  it("orders within a section by due date, longest overdue first", () => {
    const sections = build({
      assignments: [
        assignment({ id: "a", title: "Yesterday", dueAt: NOW - DAY }),
        assignment({ id: "b", title: "Last week", dueAt: NOW - 7 * DAY }),
        assignment({ id: "c", title: "An hour ago", dueAt: NOW - 3600_000 }),
      ],
    });
    expect(sections[0].items.map((i) => i.title)).toEqual(["Last week", "Yesterday", "An hour ago"]);
  });

  it("breaks ties on title so the output is deterministic", () => {
    const sections = build({
      assignments: [
        assignment({ id: "a", title: "Zebra", dueAt: NOW + DAY }),
        assignment({ id: "b", title: "Aorta", dueAt: NOW + DAY }),
      ],
    });
    expect(sections[0].items.map((i) => i.title)).toEqual(["Aorta", "Zebra"]);
  });
});

describe("buildTodo - assignments", () => {
  it("excludes completed assignments entirely", () => {
    const sections = build({
      assignments: [
        assignment({ id: "as_done", title: "Finished", status: "done", completedAt: NOW - DAY }),
        assignment({ id: "as_open", title: "Still owed" }),
      ],
    });
    expect(flatten(sections)).toEqual(["none: Still owed"]);
  });

  it("links each kind to the surface that opens it", () => {
    const sections = build({
      assignments: [
        assignment({ id: "1", kind: "doc", refId: "d1", title: "Doc" }),
        assignment({ id: "2", kind: "deck", refId: "k1", title: "Deck" }),
        assignment({ id: "3", kind: "quiz", refId: "z1", title: "Quiz" }),
        assignment({ id: "4", kind: "module", refId: "m1", title: "Module" }),
      ],
    });
    const hrefs = Object.fromEntries(sections[0].items.map((i) => [i.title, i.href]));
    expect(hrefs).toEqual({
      Doc: "/view/d1",
      Deck: "/decks/k1",
      Quiz: "/quizzes/z1",
      Module: "/modules/m1",
    });
  });

  it("names whoever handed the work out", () => {
    const sections = build({ assignments: [assignment({ assignedByName: "Dr. Singh" })] });
    expect(sections[0].items[0].meta).toBe("Module · from Dr. Singh");
  });
});

describe("buildTodo - exams", () => {
  it("counts an exam never sat as outstanding", () => {
    const sections = build({ exams: [exam({ countedAttempts: 0 })] });
    expect(flatten(sections)).toEqual(["none: Cardiology basics"]);
    expect(sections[0].items[0].href).toBe("/quizzes/q_cardio");
  });

  it("counts an exam whose every attempt was voided as OUTSTANDING, not done", () => {
    // The case that matters: the member sat it twice and neither sitting counts,
    // so the work is not finished. Treating a void as a completion would quietly
    // excuse them from an exam they still owe.
    const sections = build({
      exams: [exam({ countedAttempts: 0, totalAttempts: 2 })],
    });
    expect(flatten(sections)).toEqual(["none: Cardiology basics"]);
    expect(sections[0].items[0].meta).toBe("All 2 attempts were voided");
  });

  it("says it in the singular for one voided attempt", () => {
    const sections = build({ exams: [exam({ countedAttempts: 0, totalAttempts: 1 })] });
    expect(sections[0].items[0].meta).toBe("Your attempt was voided");
  });

  it("drops an exam once a single sitting counts", () => {
    const sections = build({
      exams: [exam({ countedAttempts: 1, totalAttempts: 3 })],
    });
    expect(sections).toEqual([]);
  });

  it("buckets an exam by its due date like anything else", () => {
    const sections = build({
      exams: [
        exam({ quizId: "q1", title: "Overdue exam", dueAt: NOW - 1 }),
        exam({ quizId: "q2", title: "Undated exam" }),
      ],
    });
    expect(flatten(sections)).toEqual(["overdue: Overdue exam", "none: Undated exam"]);
  });
});

describe("buildTodo - an exam that is also assigned", () => {
  it("lists the work once, as the assignment", () => {
    // Both describe the same sitting. The assignment is the better record: it
    // carries the due date and who handed it out, which the bare exam does not.
    const sections = build({
      assignments: [
        assignment({ id: "as_q", kind: "quiz", refId: "q_cardio", title: "Cardiology basics", dueAt: NOW + DAY }),
      ],
      exams: [exam({ quizId: "q_cardio", title: "Cardiology basics" })],
    });
    expect(todoCount(sections)).toBe(1);
    expect(sections[0].items[0].kind).toBe("assignment");
    expect(sections[0].items[0].dueAt).toBe(NOW + DAY);
  });

  it("still lists the exam when the assignment for it is already done", () => {
    // A completed assignment is not an open claim on the work, and the exam
    // still has no counting attempt - so it is genuinely outstanding.
    const sections = build({
      assignments: [
        assignment({ id: "as_q", kind: "quiz", refId: "q_cardio", status: "done", completedAt: NOW - DAY }),
      ],
      exams: [exam({ quizId: "q_cardio", title: "Cardiology basics" })],
    });
    expect(flatten(sections)).toEqual(["none: Cardiology basics"]);
    expect(sections[0].items[0].kind).toBe("exam");
  });

  it("does not confuse a quiz assignment with a different exam", () => {
    const sections = build({
      assignments: [assignment({ id: "as_q", kind: "quiz", refId: "q_other", title: "Other quiz" })],
      exams: [exam({ quizId: "q_cardio", title: "Cardiology basics" })],
    });
    expect(todoCount(sections)).toBe(2);
  });
});

describe("buildTodo - ids and counting", () => {
  it("namespaces exam ids so they cannot collide with assignment ids", () => {
    const sections = build({
      assignments: [assignment({ id: "as_1" })],
      exams: [exam({ quizId: "q1" })],
    });
    const ids = sections.flatMap((s) => s.items.map((i) => i.id));
    expect(ids).toContain("as_1");
    expect(ids).toContain("exam:q1");
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("counts every outstanding item across sections", () => {
    const sections = build({
      assignments: [
        assignment({ id: "a", dueAt: NOW - DAY }),
        assignment({ id: "b", dueAt: NOW + DAY }),
        assignment({ id: "c", dueAt: NOW + 30 * DAY }),
      ],
      exams: [exam()],
    });
    expect(sections).toHaveLength(4);
    expect(todoCount(sections)).toBe(4);
  });

  it("does not mutate the arrays it was handed", () => {
    const assignments = [
      assignment({ id: "b", title: "Zebra", dueAt: NOW + DAY }),
      assignment({ id: "a", title: "Aorta", dueAt: NOW + DAY }),
    ];
    const before = assignments.map((a) => a.id);
    build({ assignments });
    expect(assignments.map((a) => a.id)).toEqual(before);
  });
});
