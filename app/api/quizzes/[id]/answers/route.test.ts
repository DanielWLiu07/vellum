// Answer-sheet endpoint: serves the key to anyone who can view the quiz
// (study aid), 404s a private quiz for a non-viewer, and is off outside demo.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";

import { GET } from "./route";
import { createQuiz, deleteQuiz } from "@/lib/quizzes";
import { setShare } from "@/lib/resource-share";
import { __resetProfile, updateProfile } from "@/lib/profile";

const call = (id: string) =>
  GET(new NextRequest(`https://v.test/api/quizzes/${id}/answers`), { params: Promise.resolve({ id }) });

let ids: string[] = [];
beforeEach(() => {
  process.env.VELLUM_DEMO_MODE = "1";
  __resetProfile();
});
afterEach(() => {
  for (const id of ids) deleteQuiz(id);
  ids = [];
  delete process.env.VELLUM_DEMO_MODE;
});

describe("GET quiz answers", () => {
  it("returns the questions and correct indexes for a viewable quiz", async () => {
    const q = createQuiz("Key", [{ prompt: "p", choices: ["a", "b"], correctIndex: 1 }], "you");
    ids.push(q.id);
    const res = await call(q.id);
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.correctIndexes).toEqual([1]);
    expect(j.questions[0]).toEqual({ prompt: "p", choices: [{ text: "a" }, { text: "b" }] });
  });

  it("404s a private quiz for a viewer who cannot see it", async () => {
    const q = createQuiz("Secret", [{ prompt: "p", choices: ["a", "b"], correctIndex: 0 }], "someone-else");
    ids.push(q.id);
    setShare(q.id, { visibility: "private", chapter: "" });
    // Current viewer is "you" (default profile), not the owner.
    expect((await call(q.id)).status).toBe(404);
  });

  it("serves the key to a chapter member when the quiz is chapter-scoped", async () => {
    const q = createQuiz("ChapterQ", [{ prompt: "p", choices: ["a", "b"], correctIndex: 1 }], "someone-else");
    ids.push(q.id);
    setShare(q.id, { visibility: "chapter", chapter: "Toronto Central" });
    updateProfile({ chapter: "Toronto Central" });
    expect((await call(q.id)).status).toBe(200);
  });

  it("locks the key (403) for a non-owner when the quiz is an exam", async () => {
    const q = createQuiz(
      "Final",
      [{ prompt: "p", choices: ["a", "b"], correctIndex: 1 }],
      "someone-else",
      { timeLimitSec: 600 },
    );
    ids.push(q.id);
    setShare(q.id, { visibility: "public", chapter: "" });
    // Viewer "you" can VIEW it but is not the owner - exam keys are never served.
    expect((await call(q.id)).status).toBe(403);
  });

  it("still serves the key to the exam's owner", async () => {
    const q = createQuiz("Final", [{ prompt: "p", choices: ["a", "b"], correctIndex: 1 }], "you", { timeLimitSec: 600 });
    ids.push(q.id);
    const res = await call(q.id);
    expect(res.status).toBe(200);
    expect((await res.json()).correctIndexes).toEqual([1]);
  });

  it("404s a missing quiz", async () => {
    expect((await call("nope")).status).toBe(404);
  });

  it("404s when the dashboard is disabled", async () => {
    delete process.env.VELLUM_DEMO_MODE;
    const q = createQuiz("X", [{ prompt: "p", choices: ["a", "b"], correctIndex: 0 }], "you");
    ids.push(q.id);
    expect((await call(q.id)).status).toBe(404);
  });
});
