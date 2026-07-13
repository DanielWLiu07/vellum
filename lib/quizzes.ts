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

import { persistMap } from "./durable";
import { getShare } from "./resource-share";
import type { PersonShare, Visibility } from "./visibility";

/**
 * One answer choice. Carries text and/or an image (id from /api/images) - an
 * image-only choice is valid (e.g. "pick the correct ECG"), like image-only
 * prompts. Historically a choice was a bare string; `coerceChoice` upgrades old
 * data on read so both shapes coexist safely.
 */
export interface QuizChoice {
  text: string;
  imageId?: string;
}

export interface QuizQuestion {
  prompt: string;
  choices: QuizChoice[];
  correctIndex: number;
  /** Optional image shown with the prompt (id from /api/images). */
  promptImageId?: string;
}

/**
 * A question as CALLERS supply it (create/update). Choices may be bare strings
 * (legacy / convenience) or full QuizChoice objects; cleanQuestion normalizes.
 */
export interface QuizQuestionInput {
  prompt: string;
  choices: (string | QuizChoice)[];
  correctIndex: number;
  promptImageId?: string;
}

/** Upgrade a raw choice (legacy string, object, or junk) to a QuizChoice. */
export function coerceChoice(c: unknown): QuizChoice {
  if (typeof c === "string") return { text: c };
  if (c && typeof c === "object") {
    const text = String((c as { text?: unknown }).text ?? "");
    const rawImg = (c as { imageId?: unknown }).imageId;
    const imageId = rawImg ? String(rawImg).slice(0, 64) : undefined;
    return imageId ? { text, imageId } : { text };
  }
  return { text: "" };
}

/** A choice is usable if it has visible text OR an image. */
function usableChoice(c: QuizChoice): boolean {
  return Boolean(c.text.trim() || c.imageId);
}

/**
 * Exam-mode settings. Presence of this object flips a quiz from a practice
 * self-test into a timed, locked-down assessment: the answer key is withheld
 * before AND after submitting, a countdown auto-submits, and the runner records
 * advisory integrity flags (tab-switching, focus loss, copy). Integrity is
 * demo-grade and client-reported - the real proctored engine lives in the HOSA
 * member platform. Kept deliberately light here.
 */
export interface ExamSettings {
  /** Countdown length in seconds; the runner auto-submits at zero. */
  timeLimitSec: number;
}

/** Clamp bounds for a time limit: 30s to 4 hours. */
export const EXAM_MIN_SEC = 30;
export const EXAM_MAX_SEC = 4 * 60 * 60;

export interface Quiz {
  id: string;
  title: string;
  questions: QuizQuestion[];
  createdAt: number;
  owner: string;
  /** When set, this quiz is a timed, locked-down exam (see ExamSettings). */
  exam?: ExamSettings;
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
  /** True when this quiz is a timed, locked-down exam. */
  isExam: boolean;
}

/** A question with the answer stripped, for sending to a quiz-taker. */
export interface PublicQuestion {
  prompt: string;
  choices: QuizChoice[];
  promptImageId?: string;
}

export const MAX_QUIZZES = 50;
export const MAX_QUESTIONS = 100;
const TITLE_MAX = 120;
const FIELD_MAX = 500;

const g = globalThis as unknown as { __vitalsQuizzes?: Map<string, Quiz> };
const store: Map<string, Quiz> = (g.__vitalsQuizzes ??= new Map());
const { persist } = persistMap("quizzes", store);

// The `owner` check also HEALS a record seeded by an older module version
// without ownership (the globalThis map survives hot reloads / warm instances).
if (!store.get("sample-quiz")?.owner) {
  store.set("sample-quiz", {
    id: "sample-quiz",
    title: "HOSA - cardiology basics",
    questions: [
      { prompt: "A resting heart rate over 100 bpm is called:", choices: ["Bradycardia", "Tachycardia", "Systole", "Hypoxia"].map((t) => ({ text: t })), correctIndex: 1 },
      { prompt: "Which chamber pumps oxygenated blood to the body?", choices: ["Right atrium", "Right ventricle", "Left ventricle", "Left atrium"].map((t) => ({ text: t })), correctIndex: 2 },
    ],
    createdAt: 0,
    owner: "system",
  });
}

const clamp = (s: string, n: number) => s.trim().slice(0, n);

/** Normalize raw exam settings; null means "not an exam" (practice mode). */
function cleanExam(raw: unknown): ExamSettings | null {
  if (!raw || typeof raw !== "object") return null;
  const sec = (raw as { timeLimitSec?: unknown }).timeLimitSec;
  if (!Number.isFinite(sec)) return null;
  const clamped = Math.min(EXAM_MAX_SEC, Math.max(EXAM_MIN_SEC, Math.round(sec as number)));
  return { timeLimitSec: clamped };
}

/** True when a quiz is a timed, locked-down exam. */
export function isExam(q: Pick<Quiz, "exam">): boolean {
  return !!q.exam;
}

/** Compose the share sidecar into a quiz. Quizzes default to the shared pool.
 * Choices are coerced so legacy string-choice data reaches the editor as the
 * current QuizChoice shape. */
function withScope(q: Quiz): ScopedQuiz {
  const share = getShare(q.id);
  return {
    ...q,
    questions: q.questions.map((question) => ({ ...question, choices: question.choices.map(coerceChoice) })),
    visibility: share?.visibility ?? "public",
    chapter: share?.chapter ?? "",
    people: share?.people ?? [],
  };
}

/** Validate + normalize a raw question; returns null if it isn't usable. */
function cleanQuestion(q: QuizQuestionInput): QuizQuestion | null {
  const prompt = clamp(q.prompt ?? "", FIELD_MAX);
  const promptImageId = q.promptImageId ? String(q.promptImageId).slice(0, 64) : undefined;
  const rawChoices = (Array.isArray(q.choices) ? q.choices : []).map((c) => {
    const choice = coerceChoice(c);
    return { text: clamp(choice.text, FIELD_MAX), ...(choice.imageId ? { imageId: choice.imageId } : {}) };
  });
  const choices = rawChoices.filter(usableChoice);
  // A question needs at least two choices and either prompt text or an image
  // (an image-only prompt is fine - e.g. "identify this rhythm strip").
  if ((!prompt && !promptImageId) || choices.length < 2) return null;
  // correctIndex points into the UNFILTERED list the client sent. Dropping
  // empty choices shifts positions, so remap it by counting the surviving
  // choices before it — otherwise deleting an empty one ahead of the right
  // answer silently flips the key. If the marked choice was itself dropped
  // (blank, no image), fall back to 0.
  let correctIndex = 0;
  if (
    Number.isInteger(q.correctIndex) &&
    q.correctIndex >= 0 &&
    q.correctIndex < rawChoices.length &&
    usableChoice(rawChoices[q.correctIndex])
  ) {
    correctIndex = rawChoices.slice(0, q.correctIndex).filter(usableChoice).length;
  }
  return promptImageId ? { prompt, choices, correctIndex, promptImageId } : { prompt, choices, correctIndex };
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
        isExam: isExam(s),
      };
    });
}

export function getQuiz(id: string): ScopedQuiz | undefined {
  const q = store.get(id);
  return q ? withScope(q) : undefined;
}

/**
 * The quiz as a taker sees it: questions + choices, no correct answers. Exam
 * settings ARE included (the runner needs the time limit to start the clock and
 * enable lockdown) - they carry no answer information.
 */
export function getQuizForTaker(
  id: string,
): { id: string; title: string; questions: PublicQuestion[]; exam?: ExamSettings } | undefined {
  const q = store.get(id);
  if (!q) return undefined;
  return {
    id: q.id,
    title: q.title,
    questions: q.questions.map(toPublicQuestion),
    ...(q.exam ? { exam: q.exam } : {}),
  };
}

/** Strip the answer, keep the prompt/choices/image. Coerces legacy string choices. */
function toPublicQuestion(x: QuizQuestion): PublicQuestion {
  const choices = x.choices.map(coerceChoice);
  return x.promptImageId
    ? { prompt: x.prompt, choices, promptImageId: x.promptImageId }
    : { prompt: x.prompt, choices };
}

/**
 * The answer key for a quiz: public questions plus the correct index of each.
 * Powers the optional "reveal answer" study mode and the answer sheet. Callers
 * gate this on canView (these are study quizzes, not graded exams).
 */
export function getQuizAnswerKey(id: string): { id: string; title: string; questions: PublicQuestion[]; correctIndexes: number[] } | undefined {
  const q = store.get(id);
  if (!q) return undefined;
  return {
    id: q.id,
    title: q.title,
    questions: q.questions.map(toPublicQuestion),
    correctIndexes: q.questions.map((x) => x.correctIndex),
  };
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

export function createQuiz(title: string, questions: QuizQuestionInput[], owner: string, exam?: unknown): Quiz {
  const clean = questions.map(cleanQuestion).filter((q): q is QuizQuestion => q !== null).slice(0, MAX_QUESTIONS);
  const examSettings = cleanExam(exam);
  const quiz: Quiz = {
    id: `q_${crypto.randomUUID()}`,
    title: clamp(title, TITLE_MAX) || "Untitled quiz",
    questions: clean,
    createdAt: Date.now(),
    owner,
    ...(examSettings ? { exam: examSettings } : {}),
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
  persist();
  return quiz;
}

/** Replace a quiz's title, questions, and/or exam settings in place. The sample
 * is immutable. Pass `exam: null` to turn exam mode OFF; omit to leave it. */
export function updateQuiz(
  id: string,
  patch: { title?: string; questions?: QuizQuestionInput[]; exam?: unknown },
): Quiz | undefined {
  if (id === "sample-quiz") return undefined;
  const quiz = store.get(id);
  if (!quiz) return undefined;
  if (patch.title !== undefined) quiz.title = clamp(patch.title, TITLE_MAX) || "Untitled quiz";
  // A live-editor quiz may be emptied (draft you're still filling in); the
  // editor autosaves what's on screen, so 0 questions is a valid state.
  if (patch.questions !== undefined) {
    quiz.questions = patch.questions.map(cleanQuestion).filter((q): q is QuizQuestion => q !== null).slice(0, MAX_QUESTIONS);
  }
  if (patch.exam !== undefined) {
    const examSettings = cleanExam(patch.exam);
    if (examSettings) quiz.exam = examSettings;
    else delete quiz.exam;
  }
  persist();
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
    src.exam,
  );
}

export function deleteQuiz(id: string): boolean {
  if (id === "sample-quiz") return false;
  const ok = store.delete(id);
  if (ok) persist();
  return ok;
}
