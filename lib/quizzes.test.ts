import { beforeEach, describe, expect, it } from "vitest";

import { createQuiz as createQuizRaw, deleteQuiz, duplicateQuiz, getQuiz, getQuizForTaker, gradeQuiz, listQuizzes, updateQuiz } from "./quizzes";

// The store now requires an owner (Google-Docs-style ownership); these
// content-validation tests all create as the demo viewer.
const createQuiz = (title: Parameters<typeof createQuizRaw>[0], items: Parameters<typeof createQuizRaw>[1]) =>
  createQuizRaw(title, items, "you");

describe("quiz store", () => {
  let created: string[] = [];
  beforeEach(() => {
    for (const id of created) deleteQuiz(id);
    created = [];
  });

  it("creates a quiz and drops questions without a prompt or with <2 choices", () => {
    const q = createQuiz("Anatomy", [
      { prompt: "Largest organ?", choices: ["Skin", "Liver"], correctIndex: 0 },
      { prompt: "", choices: ["a", "b"], correctIndex: 0 }, // no prompt, dropped
      { prompt: "Only one choice", choices: ["x"], correctIndex: 0 }, // too few, dropped
    ]);
    created.push(q.id);
    expect(q.questions).toHaveLength(1);
    expect(listQuizzes().some((x) => x.id === q.id && x.questionCount === 1)).toBe(true);
  });

  it("clamps an out-of-range correctIndex back to 0", () => {
    const q = createQuiz("X", [{ prompt: "p", choices: ["a", "b"], correctIndex: 9 }]);
    created.push(q.id);
    expect(q.questions[0]!.correctIndex).toBe(0);
  });

  it("getQuizForTaker strips the correct answers", () => {
    const q = createQuiz("X", [{ prompt: "p", choices: ["a", "b"], correctIndex: 1 }]);
    created.push(q.id);
    const taker = getQuizForTaker(q.id)!;
    expect(taker.questions[0]).toEqual({ prompt: "p", choices: ["a", "b"] });
    expect(JSON.stringify(taker)).not.toContain("correctIndex");
  });

  it("grades answers against the key", () => {
    const q = createQuiz("X", [
      { prompt: "p1", choices: ["a", "b"], correctIndex: 1 },
      { prompt: "p2", choices: ["a", "b"], correctIndex: 0 },
    ]);
    created.push(q.id);
    const r = gradeQuiz(q.id, [1, 1])!;
    expect(r).toEqual({ score: 1, total: 2, correct: [true, false], correctIndexes: [1, 0] });
  });

  it("keeps the sample quiz immutable", () => {
    expect(deleteQuiz("sample-quiz")).toBe(false);
  });
});

describe("quiz ownership + editing", () => {
  it("createQuiz records the owner; scope defaults to the shared pool", () => {
    const q = createQuizRaw("Owned", [{ prompt: "p", choices: ["a", "b"], correctIndex: 0 }], "ava");
    try {
      const got = getQuiz(q.id)!;
      expect(got.owner).toBe("ava");
      expect(got.visibility).toBe("public");
      expect(got.people).toEqual([]);
    } finally {
      deleteQuiz(q.id);
    }
  });

  it("updateQuiz edits in place, re-validating questions", () => {
    const q = createQuiz("Before", [{ prompt: "p", choices: ["a", "b"], correctIndex: 1 }]);
    try {
      const updated = updateQuiz(q.id, {
        title: "After",
        questions: [
          { prompt: "good", choices: ["a", "b", "c"], correctIndex: 2 },
          { prompt: "", choices: ["a", "b"], correctIndex: 0 }, // dropped: no prompt
        ],
      })!;
      expect(updated.title).toBe("After");
      expect(updated.questions).toHaveLength(1);
      expect(updated.questions[0]!.correctIndex).toBe(2);
    } finally {
      deleteQuiz(q.id);
    }
  });

  it("updateQuiz refuses to empty a quiz and refuses the sample", () => {
    const q = createQuiz("Keep", [{ prompt: "p", choices: ["a", "b"], correctIndex: 0 }]);
    try {
      expect(updateQuiz(q.id, { questions: [{ prompt: "", choices: [], correctIndex: 0 }] })).toBeUndefined();
      expect(getQuiz(q.id)!.questions).toHaveLength(1);
      expect(updateQuiz("sample-quiz", { title: "hijack" })).toBeUndefined();
    } finally {
      deleteQuiz(q.id);
    }
  });

  it("remaps correctIndex when blank choices ahead of it are dropped (no key flip)", () => {
    // Client sends ["", "Right"(correct=1), "Wrong"]. The blank is dropped, so
    // the surviving list is ["Right","Wrong"]; the key must still point at
    // "Right" (index 0), not slide onto "Wrong".
    const q = createQuiz("Shift", [{ prompt: "p", choices: ["", "Right", "Wrong"], correctIndex: 1 }]);
    try {
      expect(getQuiz(q.id)!.questions[0]).toEqual({ prompt: "p", choices: ["Right", "Wrong"], correctIndex: 0 });
    } finally {
      deleteQuiz(q.id);
    }
  });

  it("falls back to 0 when the marked choice itself was blank", () => {
    const q = createQuiz("BlankKey", [{ prompt: "p", choices: ["A", "", "B"], correctIndex: 1 }]);
    try {
      expect(getQuiz(q.id)!.questions[0]!.correctIndex).toBe(0);
    } finally {
      deleteQuiz(q.id);
    }
  });

  it("duplicateQuiz clones the answer key under the new owner, independently", () => {
    const src = createQuiz("Original", [{ prompt: "p", choices: ["a", "b"], correctIndex: 1 }]);
    const copy = duplicateQuiz(src.id, "ben")!;
    try {
      expect(copy.title).toBe("Copy of Original");
      expect(copy.owner).toBe("ben");
      expect(copy.questions).toEqual(src.questions);
      updateQuiz(copy.id, { questions: [{ prompt: "changed", choices: ["x", "y"], correctIndex: 0 }] });
      expect(getQuiz(src.id)!.questions[0]!.prompt).toBe("p");
    } finally {
      deleteQuiz(src.id);
      deleteQuiz(copy.id);
    }
  });
});
