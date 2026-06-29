import { beforeEach, describe, expect, it } from "vitest";

import { createQuiz, deleteQuiz, getQuizForTaker, gradeQuiz, listQuizzes } from "./quizzes";

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
