/**
 * Study quizzes for HOSA Vitals (self-test, not graded exams).
 *
 * Demo-grade in-memory store, mirroring lib/decks.ts. Quizzes live in the shared
 * pool. Grading happens server-side so the correct answers are never sent to the
 * browser with the questions; a production build swaps the store for a database.
 *
 * Note: real scored FLC tests belong in the HOSA member platform's test engine,
 * which has auth, persistence, and integrity controls this demo deliberately
 * does not.
 */

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
}

export interface QuizMeta {
  id: string;
  title: string;
  questionCount: number;
  createdAt: number;
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

if (!store.has("sample-quiz")) {
  store.set("sample-quiz", {
    id: "sample-quiz",
    title: "HOSA - cardiology basics",
    questions: [
      { prompt: "A resting heart rate over 100 bpm is called:", choices: ["Bradycardia", "Tachycardia", "Systole", "Hypoxia"], correctIndex: 1 },
      { prompt: "Which chamber pumps oxygenated blood to the body?", choices: ["Right atrium", "Right ventricle", "Left ventricle", "Left atrium"], correctIndex: 2 },
    ],
    createdAt: 0,
  });
}

const clamp = (s: string, n: number) => s.trim().slice(0, n);

/** Validate + normalize a raw question; returns null if it isn't usable. */
function cleanQuestion(q: QuizQuestion): QuizQuestion | null {
  const prompt = clamp(q.prompt ?? "", FIELD_MAX);
  const choices = (Array.isArray(q.choices) ? q.choices : [])
    .map((c) => clamp(String(c ?? ""), FIELD_MAX))
    .filter(Boolean);
  if (!prompt || choices.length < 2) return null;
  const correctIndex = Number.isInteger(q.correctIndex) && q.correctIndex >= 0 && q.correctIndex < choices.length ? q.correctIndex : 0;
  return { prompt, choices, correctIndex };
}

export function listQuizzes(): QuizMeta[] {
  return [...store.values()]
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((q) => ({ id: q.id, title: q.title, questionCount: q.questions.length, createdAt: q.createdAt }));
}

export function getQuiz(id: string): Quiz | undefined {
  return store.get(id);
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

export function createQuiz(title: string, questions: QuizQuestion[]): Quiz {
  const clean = questions.map(cleanQuestion).filter((q): q is QuizQuestion => q !== null).slice(0, MAX_QUESTIONS);
  const quiz: Quiz = {
    id: `q_${crypto.randomUUID()}`,
    title: clamp(title, TITLE_MAX) || "Untitled quiz",
    questions: clean,
    createdAt: Date.now(),
  };
  store.set(quiz.id, quiz);
  const userQuizzes = [...store.values()].filter((q) => q.id !== "sample-quiz").sort((a, b) => a.createdAt - b.createdAt);
  while (userQuizzes.length > MAX_QUIZZES) {
    const old = userQuizzes.shift();
    if (old) store.delete(old.id);
  }
  return quiz;
}

export function deleteQuiz(id: string): boolean {
  if (id === "sample-quiz") return false;
  return store.delete(id);
}
