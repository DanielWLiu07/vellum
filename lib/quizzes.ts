/**
 * Study quizzes for HOSA Vitals (self-test, not graded exams).
 *
 * Demo-grade in-memory store, mirroring lib/decks.ts. Quizzes are owned
 * resources: they default to the shared pool (public), and the owner can
 * rescope them or grant per-person access via the share sidecar — the same
 * Google-Docs-style model documents and decks use. Grading happens server-side
 * so the correct answers are never sent to the browser with the questions; a
 * production build swaps the store for a database.
 *
 * Note: real scored FLC tests belong in the HOSA member platform's test engine,
 * which has auth, persistence, and integrity controls this demo deliberately
 * does not.
 */

import { getShare } from "./resource-share";
import type { PersonShare, Visibility } from "./visibility";

export interface QuizQuestion {
  prompt: string;
  choices: string[];
  correctIndex: number;
}

export interface Quiz {
  id: string;
  title: string;
  questions: QuizQuestion[];
  createdAt: number;
  owner: string;
}

/** A quiz with its share state composed in (what routes and the UI consume). */
export interface ScopedQuiz extends Quiz {
  visibility: Visibility;
  chapter: string;
  people: PersonShare[];
}

export interface QuizMeta {
  id: string;
  title: string;
  questionCount: number;
  createdAt: number;
  owner: string;
  visibility: Visibility;
  chapter: string;
  people: PersonShare[];
}

/** A question with the answer stripped, for sending to a quiz-taker. */
export interface PublicQuestion {
  prompt: string;
  choices: string[];
}

export const MAX_QUIZZES = 50;
export const MAX_QUESTIONS = 100;
const TITLE_MAX = 120;
const FIELD_MAX = 500;

const g = globalThis as unknown as { __vitalsQuizzes?: Map<string, Quiz> };
const store: Map<string, Quiz> = (g.__vitalsQuizzes ??= new Map());

// The `owner` check also HEALS a record seeded by an older module version
// without ownership (the globalThis map survives hot reloads / warm instances).
if (!store.get("sample-quiz")?.owner) {
  store.set("sample-quiz", {
    id: "sample-quiz",
    title: "HOSA - cardiology basics",
    questions: [
      { prompt: "A resting heart rate over 100 bpm is called:", choices: ["Bradycardia", "Tachycardia", "Systole", "Hypoxia"], correctIndex: 1 },
      { prompt: "Which chamber pumps oxygenated blood to the body?", choices: ["Right atrium", "Right ventricle", "Left ventricle", "Left atrium"], correctIndex: 2 },
    ],
    createdAt: 0,
    owner: "system",
  });
}

const clamp = (s: string, n: number) => s.trim().slice(0, n);

/** Compose the share sidecar into a quiz. Quizzes default to the shared pool. */
function withScope(q: Quiz): ScopedQuiz {
  const share = getShare(q.id);
  return {
    ...q,
    visibility: share?.visibility ?? "public",
    chapter: share?.chapter ?? "",
    people: share?.people ?? [],
  };
}

/** Validate + normalize a raw question; returns null if it isn't usable. */
function cleanQuestion(q: QuizQuestion): QuizQuestion | null {
  const prompt = clamp(q.prompt ?? "", FIELD_MAX);
  const rawChoices = (Array.isArray(q.choices) ? q.choices : []).map((c) => clamp(String(c ?? ""), FIELD_MAX));
  const choices = rawChoices.filter(Boolean);
  if (!prompt || choices.length < 2) return null;
  // correctIndex points into the UNFILTERED list the client sent. Dropping
  // blank choices shifts positions, so remap it by counting the surviving
  // choices before it — otherwise deleting a blank ahead of the right answer
  // silently flips the key to a different choice. If the marked choice was
  // itself blank (dropped), fall back to 0.
  let correctIndex = 0;
  if (
    Number.isInteger(q.correctIndex) &&
    q.correctIndex >= 0 &&
    q.correctIndex < rawChoices.length &&
    rawChoices[q.correctIndex]
  ) {
    correctIndex = rawChoices.slice(0, q.correctIndex).filter(Boolean).length;
  }
  return { prompt, choices, correctIndex };
}

export function listQuizzes(): QuizMeta[] {
  return [...store.values()]
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((q) => {
      const s = withScope(q);
      return {
        id: s.id,
        title: s.title,
        questionCount: s.questions.length,
        createdAt: s.createdAt,
        owner: s.owner,
        visibility: s.visibility,
        chapter: s.chapter,
        people: s.people,
      };
    });
}

export function getQuiz(id: string): ScopedQuiz | undefined {
  const q = store.get(id);
  return q ? withScope(q) : undefined;
}

/** The quiz as a taker sees it: questions + choices, no correct answers. */
export function getQuizForTaker(id: string): { id: string; title: string; questions: PublicQuestion[] } | undefined {
  const q = store.get(id);
  if (!q) return undefined;
  return { id: q.id, title: q.title, questions: q.questions.map((x) => ({ prompt: x.prompt, choices: x.choices })) };
}

/** Score a set of answers (one choice index per question) against the key. */
export function gradeQuiz(
  id: string,
  answers: number[],
): { score: number; total: number; correct: boolean[]; correctIndexes: number[] } | undefined {
  const q = store.get(id);
  if (!q) return undefined;
  const correctIndexes = q.questions.map((question) => question.correctIndex);
  const correct = q.questions.map((question, i) => answers[i] === question.correctIndex);
  // The key is revealed only AFTER submitting, so a study taker can learn from misses.
  return { score: correct.filter(Boolean).length, total: q.questions.length, correct, correctIndexes };
}

export function createQuiz(title: string, questions: QuizQuestion[], owner: string): Quiz {
  const clean = questions.map(cleanQuestion).filter((q): q is QuizQuestion => q !== null).slice(0, MAX_QUESTIONS);
  const quiz: Quiz = {
    id: `q_${crypto.randomUUID()}`,
    title: clamp(title, TITLE_MAX) || "Untitled quiz",
    questions: clean,
    createdAt: Date.now(),
    owner,
  };
  store.set(quiz.id, quiz);
  // Cap the store, evicting only the NEW owner's own oldest quizzes (never the
  // sample, never another owner's) — a global eviction let a copy silently
  // delete quizzes the caller doesn't own. See the storage-layer note.
  const mine = [...store.values()]
    .filter((q) => q.id !== "sample-quiz" && q.owner === owner)
    .sort((a, b) => a.createdAt - b.createdAt);
  while (mine.length > MAX_QUIZZES) {
    const old = mine.shift();
    if (old) store.delete(old.id);
  }
  return quiz;
}

/** Replace a quiz's title and/or questions in place. The sample is immutable. */
export function updateQuiz(
  id: string,
  patch: { title?: string; questions?: QuizQuestion[] },
): Quiz | undefined {
  if (id === "sample-quiz") return undefined;
  const quiz = store.get(id);
  if (!quiz) return undefined;
  if (patch.title !== undefined) quiz.title = clamp(patch.title, TITLE_MAX) || "Untitled quiz";
  if (patch.questions !== undefined) {
    const clean = patch.questions.map(cleanQuestion).filter((q): q is QuizQuestion => q !== null).slice(0, MAX_QUESTIONS);
    if (clean.length === 0) return undefined; // don't let an update empty a quiz
    quiz.questions = clean;
  }
  return quiz;
}

/**
 * Google-Docs "Make a copy": a full clone under the caller's ownership. The
 * caller decides the copy's scope (share sidecar) — copies start private.
 */
export function duplicateQuiz(id: string, owner: string): Quiz | undefined {
  const src = store.get(id);
  if (!src) return undefined;
  return createQuiz(
    `Copy of ${src.title}`,
    src.questions.map((q) => ({ ...q, choices: [...q.choices] })),
    owner,
  );
}

export function deleteQuiz(id: string): boolean {
  if (id === "sample-quiz") return false;
  return store.delete(id);
}
