// The assignment store: what may be assigned, who may complete it, who may
// take it back, and how a chapter's oversight list is scoped.

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  MAX_PER_ASSIGNEE,
  __resetAssignments,
  completionStats,
  createAssignment,
  getAssignment,
  isAssignmentKind,
  listAllAssignments,
  listAssignmentsBy,
  listAssignmentsFor,
  markDone,
  resolveParts,
  resolveRef,
  setStatus,
  unassign,
} from "./assignments";
import { createDeck } from "./decks";
import { __resetModules, createModule, updateModule } from "./modules";
import { createQuiz } from "./quizzes";

const CHAPTER = "Toronto Central";
const TRAINER = { id: "t_1", name: "Coach Rivera" };
const STUDENT = "s_ada";

/** A trainer assigning `refId` of `kind` to a student in their chapter. */
const assign = (kind: string, refId: string, assigneeId = STUDENT, extra: { dueAt?: unknown; by?: string; parts?: unknown } = {}) =>
  createAssignment({
    kind,
    refId,
    assigneeId,
    assignedBy: extra.by ?? TRAINER.id,
    assignedByName: TRAINER.name,
    chapter: CHAPTER,
    dueAt: extra.dueAt,
    parts: extra.parts,
  });

let moduleId = "";

beforeEach(() => {
  __resetAssignments();
  __resetModules();
  moduleId = createModule("Airway Management", TRAINER.id).id;
});
afterEach(() => {
  __resetAssignments();
  __resetModules();
});

describe("resolveRef", () => {
  it("finds each content kind in its own store and returns its title", async () => {
    const deck = createDeck("Cardio terms", [{ front: "a", back: "b" }], TRAINER.id);
    const quiz = createQuiz("Anatomy unit 2", [{ prompt: "Q", choices: ["a", "b"], correctIndex: 0 }], TRAINER.id);
    expect(await resolveRef("module", moduleId)).toMatchObject({ kind: "module", title: "Airway Management" });
    expect(await resolveRef("deck", deck.id)).toMatchObject({ kind: "deck", title: "Cardio terms" });
    expect(await resolveRef("quiz", quiz.id)).toMatchObject({ kind: "quiz", title: "Anatomy unit 2" });
    // "sample" is the bundled document every deployment ships with.
    expect(await resolveRef("doc", "sample")).toMatchObject({ kind: "doc", title: "Vitals - overview (sample)" });
  });

  it("rejects an unknown kind and an id that isn't in the store", async () => {
    expect(isAssignmentKind("video")).toBe(false);
    expect(await resolveRef("video", moduleId)).toBeNull();
    expect(await resolveRef("module", "m_does_not_exist")).toBeNull();
    expect(await resolveRef("module", "")).toBeNull();
  });
});

describe("createAssignment", () => {
  it("denormalizes the referenced title and starts as todo", async () => {
    const res = await assign("module", moduleId, STUDENT, { dueAt: 1_800_000_000_000 });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.assignment).toMatchObject({
      kind: "module",
      refId: moduleId,
      title: "Airway Management",
      assigneeId: STUDENT,
      assignedBy: TRAINER.id,
      assignedByName: TRAINER.name,
      chapter: CHAPTER,
      dueAt: 1_800_000_000_000,
      status: "todo",
      completedAt: null,
    });
    expect(res.duplicate).toBe(false);
  });

  it("refuses content that doesn't exist, and an unknown kind", async () => {
    expect(await assign("module", "m_nope")).toEqual({ ok: false, error: "bad_ref" });
    expect(await assign("video", moduleId)).toEqual({ ok: false, error: "bad_ref" });
  });

  it("refuses a missing assignee or assigner", async () => {
    expect(await assign("module", moduleId, "")).toEqual({ ok: false, error: "bad_assignee" });
    expect(await assign("module", moduleId, STUDENT, { by: "" })).toEqual({ ok: false, error: "bad_assignee" });
  });

  it("drops a junk or absurdly distant due date instead of storing it", async () => {
    for (const dueAt of ["soon", NaN, -1, Date.now() + 40 * 365 * 24 * 3600_000]) {
      __resetAssignments();
      const res = await assign("module", moduleId, STUDENT, { dueAt });
      expect(res.ok && res.assignment.dueAt).toBeNull();
    }
  });

  it("returns the existing record instead of stacking a second open copy", async () => {
    const first = await assign("module", moduleId);
    const again = await assign("module", moduleId);
    expect(again.ok && again.duplicate).toBe(true);
    expect(again.ok && first.ok && again.assignment.id).toBe(first.ok ? first.assignment.id : "");
    expect(listAssignmentsFor(STUDENT)).toHaveLength(1);
  });

  it("allows re-assigning something the member already finished", async () => {
    const first = await assign("module", moduleId);
    if (!first.ok) throw new Error("setup failed");
    markDone(first.assignment.id, STUDENT);
    const again = await assign("module", moduleId);
    expect(again.ok && again.duplicate).toBe(false);
    expect(listAssignmentsFor(STUDENT)).toHaveLength(2);
  });

  it("caps how much one member can be assigned", async () => {
    for (let i = 0; i < MAX_PER_ASSIGNEE; i++) {
      const m = createModule(`Filler ${i}`, TRAINER.id);
      const res = await assign("module", m.id);
      expect(res.ok).toBe(true);
    }
    expect(await assign("module", moduleId)).toEqual({ ok: false, error: "limit" });
  });
});

describe("listing", () => {
  it("gives a member their own assignments, newest first", async () => {
    const older = await assign("module", moduleId, STUDENT);
    const other = createModule("Second", TRAINER.id);
    const newer = await assign("module", other.id, STUDENT);
    await assign("module", moduleId, "s_liam");

    const mine = listAssignmentsFor(STUDENT);
    expect(mine.map((a) => a.id)).toEqual([
      newer.ok ? newer.assignment.id : "",
      older.ok ? older.assignment.id : "",
    ]);
    expect(listAssignmentsFor("s_liam")).toHaveLength(1);
    expect(listAllAssignments()).toHaveLength(3);
  });

  it("scopes chapter oversight to one chapter", async () => {
    await assign("module", moduleId, STUDENT);
    await createAssignment({
      kind: "module", refId: moduleId, assigneeId: "s_far", assignedBy: "t_2",
      assignedByName: "Dr. Singh", chapter: "Vancouver West",
    });
    expect(listAssignmentsBy(CHAPTER).map((a) => a.assigneeId)).toEqual([STUDENT]);
    expect(listAssignmentsBy("Vancouver West").map((a) => a.assigneeId)).toEqual(["s_far"]);
  });

  it("returns nothing for a blank chapter rather than everyone's", async () => {
    await createAssignment({
      kind: "module", refId: moduleId, assigneeId: "s_nochapter", assignedBy: TRAINER.id,
      assignedByName: TRAINER.name, chapter: "",
    });
    expect(listAssignmentsBy("")).toEqual([]);
  });
});

describe("markDone", () => {
  it("lets the assignee complete their own work", async () => {
    const res = await assign("module", moduleId);
    if (!res.ok) throw new Error("setup failed");
    const done = markDone(res.assignment.id, STUDENT);
    expect(done.ok && done.assignment.status).toBe("done");
    expect(done.ok && typeof done.assignment.completedAt).toBe("number");
  });

  it("keeps the original completion time when done twice", async () => {
    const res = await assign("module", moduleId);
    if (!res.ok) throw new Error("setup failed");
    const first = markDone(res.assignment.id, STUDENT);
    const second = markDone(res.assignment.id, STUDENT);
    expect(second.ok && first.ok && second.assignment.completedAt).toBe(first.ok ? first.assignment.completedAt : 0);
  });

  it("refuses anyone who isn't the assignee - including the trainer who assigned it", async () => {
    const res = await assign("module", moduleId);
    if (!res.ok) throw new Error("setup failed");
    expect(markDone(res.assignment.id, "s_liam")).toEqual({ ok: false, error: "forbidden" });
    expect(markDone(res.assignment.id, TRAINER.id)).toEqual({ ok: false, error: "forbidden" });
    expect(getAssignment(res.assignment.id)?.status).toBe("todo");
  });

  it("404s an id that isn't an assignment", () => {
    expect(markDone("as_nope", STUDENT)).toEqual({ ok: false, error: "not_found" });
  });
});

describe("unassign", () => {
  it("lets the assigner take it back", async () => {
    const res = await assign("module", moduleId);
    if (!res.ok) throw new Error("setup failed");
    expect(unassign(res.assignment.id, { owner: TRAINER.id, admin: false }).ok).toBe(true);
    expect(getAssignment(res.assignment.id)).toBeUndefined();
  });

  it("lets any admin take back someone else's assignment", async () => {
    const res = await assign("module", moduleId);
    if (!res.ok) throw new Error("setup failed");
    expect(unassign(res.assignment.id, { owner: "admin_1", admin: true }).ok).toBe(true);
  });

  it("refuses another trainer and the assignee themselves", async () => {
    const res = await assign("module", moduleId);
    if (!res.ok) throw new Error("setup failed");
    expect(unassign(res.assignment.id, { owner: "t_2", admin: false })).toEqual({ ok: false, error: "forbidden" });
    expect(unassign(res.assignment.id, { owner: STUDENT, admin: false })).toEqual({ ok: false, error: "forbidden" });
    expect(getAssignment(res.assignment.id)).toBeDefined();
  });

  it("404s an id that isn't an assignment", () => {
    expect(unassign("as_nope", { owner: TRAINER.id, admin: true })).toEqual({ ok: false, error: "not_found" });
  });
});

describe("completionStats", () => {
  it("counts assigned/done per member and zero-fills the rest of the roster", async () => {
    const second = createModule("Second", TRAINER.id);
    const a = await assign("module", moduleId, STUDENT);
    await assign("module", second.id, STUDENT);
    await assign("module", moduleId, "s_liam");
    if (!a.ok) throw new Error("setup failed");
    markDone(a.assignment.id, STUDENT);

    expect(completionStats([STUDENT, "s_liam", "s_never_assigned"])).toEqual({
      [STUDENT]: { assigned: 2, done: 1 },
      s_liam: { assigned: 1, done: 0 },
      s_never_assigned: { assigned: 0, done: 0 },
    });
  });
});

// --- parts: assigning only some sections of a module ---------------------
// Absent `parts` has to keep meaning "the whole module", because every
// assignment made before the field existed has no parts and means exactly that.

/** A module whose sections we know by id, for narrowing. */
function threeSectionModule(): string {
  const id = createModule("EMT Fundamentals", TRAINER.id).id;
  updateModule(id, {
    sections: [
      { id: "sec1", title: "Scene safety", subsections: [{ id: "ss1", title: "Part 1", blocks: [] }] },
      { id: "sec2", title: "Patient assessment", subsections: [{ id: "ss2", title: "Part 1", blocks: [] }] },
      { id: "sec3", title: "Vital signs", subsections: [{ id: "ss3", title: "Part 1", blocks: [] }] },
    ],
  });
  return id;
}

describe("resolveParts", () => {
  it("reads titles off the module, in the module's own order", () => {
    const id = threeSectionModule();
    // Ticked out of order; stored in reading order.
    expect(resolveParts(id, ["sec3", "sec1"])).toEqual([
      { id: "sec1", title: "Scene safety" },
      { id: "sec3", title: "Vital signs" },
    ]);
  });

  it("treats every section as the whole module, not as a parts list", () => {
    const id = threeSectionModule();
    expect(resolveParts(id, ["sec1", "sec2", "sec3"])).toBeNull();
  });

  it("refuses a stale id rather than quietly assigning less", () => {
    const id = threeSectionModule();
    expect(resolveParts(id, ["sec1", "sec-removed"])).toBeNull();
  });

  it("is null for an empty list and an unknown module", () => {
    expect(resolveParts(threeSectionModule(), [])).toBeNull();
    expect(resolveParts("nope", ["sec1"])).toBeNull();
  });
});

describe("createAssignment with parts", () => {
  it("stores the narrowed sections", async () => {
    const id = threeSectionModule();
    const res = await assign("module", id, STUDENT, { parts: ["sec2"] });
    expect(res.ok && res.assignment.parts).toEqual([{ id: "sec2", title: "Patient assessment" }]);
  });

  it("leaves parts absent when the whole module is assigned", async () => {
    const id = threeSectionModule();
    const res = await assign("module", id);
    expect(res.ok && "parts" in res.assignment).toBe(false);
  });

  it("refuses parts that do not resolve", async () => {
    const id = threeSectionModule();
    const res = await assign("module", id, STUDENT, { parts: ["ghost"] });
    expect(res).toEqual({ ok: false, error: "bad_parts" });
  });

  it("does not treat different sections of one module as duplicates", async () => {
    const id = threeSectionModule();
    const a = await assign("module", id, STUDENT, { parts: ["sec1"] });
    const b = await assign("module", id, STUDENT, { parts: ["sec2"] });
    expect(a.ok && b.ok && b.duplicate).toBe(false);
    expect(listAssignmentsFor(STUDENT)).toHaveLength(2);
  });

  it("still collapses a repeat of the SAME sections", async () => {
    const id = threeSectionModule();
    await assign("module", id, STUDENT, { parts: ["sec1"] });
    const again = await assign("module", id, STUDENT, { parts: ["sec1"] });
    expect(again.ok && again.duplicate).toBe(true);
    expect(listAssignmentsFor(STUDENT)).toHaveLength(1);
  });

  it("ignores parts on kinds that have no sections", async () => {
    const deck = createDeck("Terms", [{ front: "a", back: "b" }], TRAINER.id).id;
    const res = await assign("deck", deck, STUDENT, { parts: ["sec1"] });
    expect(res.ok && "parts" in res.assignment).toBe(false);
  });
});

describe("setStatus", () => {
  it("reopens a completed assignment and clears completedAt", async () => {
    const res = await assign("module", moduleId);
    const id = (res as { assignment: { id: string } }).assignment.id;

    expect(setStatus(id, STUDENT, "done").ok).toBe(true);
    expect(getAssignment(id)?.status).toBe("done");
    expect(typeof getAssignment(id)?.completedAt).toBe("number");

    expect(setStatus(id, STUDENT, "todo").ok).toBe(true);
    expect(getAssignment(id)?.status).toBe("todo");
    // Not a stale timestamp on a row that is no longer done.
    expect(getAssignment(id)?.completedAt).toBeNull();
  });

  it("still lets only the assignee change it", async () => {
    const res = await assign("module", moduleId);
    const id = (res as { assignment: { id: string } }).assignment.id;
    expect(setStatus(id, TRAINER.id, "done")).toEqual({ ok: false, error: "forbidden" });
  });

  it("keeps a reopened assignment out of the done count", async () => {
    const res = await assign("module", moduleId);
    const id = (res as { assignment: { id: string } }).assignment.id;
    setStatus(id, STUDENT, "done");
    expect(completionStats([STUDENT])[STUDENT]?.done).toBe(1);
    setStatus(id, STUDENT, "todo");
    expect(completionStats([STUDENT])[STUDENT]?.done).toBe(0);
  });
});
