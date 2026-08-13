"use client";

import Link from "next/link";
import * as React from "react";

import { RETURN_TO, returnLabel } from "@/lib/return-to";

import { ReportProblem } from "./report-problem";

type Choice = { text: string; imageId?: string };
type TakerQuestion = { prompt: string; choices: Choice[]; promptImageId?: string };
type ExamSettings = { timeLimitSec: number };
type TakerQuiz = { id: string; title: string; questions: TakerQuestion[]; exam?: ExamSettings };
// Practice results carry the key (learn from misses); exam results never do.
type Result = {
  score: number;
  total: number;
  correct?: boolean[];
  correctIndexes?: number[];
  exam?: boolean;
  voided?: boolean;
};
type IntegrityKind = "hidden" | "blur" | "fullscreen-exit" | "copy" | "paste" | "contextmenu";
type IntegrityFlag = { kind: IntegrityKind; at: number };

function fmtClock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

export function QuizTake({ quizId, backHref = RETURN_TO.quizzes }: {
  quizId: string;
  /** Validated destination for every way out of the quiz (see lib/return-to). */
  backHref?: string;
}) {
  const backLabel = returnLabel(backHref);
  const [quiz, setQuiz] = React.useState<TakerQuiz | null>(null);
  const [err, setErr] = React.useState(false);
  const [answers, setAnswers] = React.useState<number[]>([]);
  const [result, setResult] = React.useState<Result | null>(null);
  const [busy, setBusy] = React.useState(false);
  // Optional study aids - practice mode only (revealing the key is a study aid,
  // never available in exam mode).
  const [study, setStudy] = React.useState(false);
  const [answerKey, setAnswerKey] = React.useState<number[] | null>(null);
  const [shown, setShown] = React.useState<Set<number>>(new Set());
  const [sheetOpen, setSheetOpen] = React.useState(false);

  // Exam-mode runtime state.
  const [started, setStarted] = React.useState(false);
  const [remaining, setRemaining] = React.useState<number | null>(null);
  const startedAtRef = React.useRef(0);
  const flagsRef = React.useRef<IntegrityFlag[]>([]);
  const answersRef = React.useRef<number[]>([]);
  const submittedRef = React.useRef(false);

  const isExam = Boolean(quiz?.exam);

  React.useEffect(() => {
    answersRef.current = answers;
  }, [answers]);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch(`/api/quizzes/${quizId}`, { cache: "no-store" }).catch(() => null);
      if (cancelled) return;
      if (!res || !res.ok) {
        setErr(true);
        return;
      }
      const q = (await res.json()).quiz as TakerQuiz;
      setQuiz(q);
      setAnswers(new Array(q.questions.length).fill(-1));
    })();
    return () => {
      cancelled = true;
    };
  }, [quizId]);

  // Record one advisory integrity flag (client-reported; see the server note).
  const flag = React.useCallback((kind: IntegrityKind) => {
    if (submittedRef.current) return;
    flagsRef.current.push({ kind, at: Date.now() - startedAtRef.current });
  }, []);

  const submit = React.useCallback(
    async (autoSubmitted = false) => {
      if (submittedRef.current) return;
      submittedRef.current = true;
      setBusy(true);
      try {
        const res = await fetch(`/api/quizzes/${quizId}/grade`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            isExam
              ? {
                  answers: answersRef.current,
                  startedAt: startedAtRef.current,
                  autoSubmitted,
                  flags: flagsRef.current,
                }
              : { answers: answersRef.current },
          ),
        });
        if (res.ok) setResult(await res.json());
        else submittedRef.current = false;
        // Leave fullscreen once the exam is over.
        if (isExam && document.fullscreenElement) await document.exitFullscreen().catch(() => {});
      } finally {
        setBusy(false);
      }
    },
    [isExam, quizId],
  );

  // Exam integrity listeners + countdown, active only while the exam is running.
  React.useEffect(() => {
    if (!started || result) return;
    const onVis = () => document.visibilityState === "hidden" && flag("hidden");
    const onBlur = () => flag("blur");
    const onFsChange = () => !document.fullscreenElement && flag("fullscreen-exit");
    const onCopy = () => flag("copy");
    const onPaste = () => flag("paste");
    const onContext = (e: MouseEvent) => {
      e.preventDefault();
      flag("contextmenu");
    };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("blur", onBlur);
    document.addEventListener("fullscreenchange", onFsChange);
    document.addEventListener("copy", onCopy);
    document.addEventListener("paste", onPaste);
    document.addEventListener("contextmenu", onContext);

    const tick = setInterval(() => {
      setRemaining((r) => {
        if (r === null) return r;
        if (r <= 1) {
          clearInterval(tick);
          void submit(true); // time's up
          return 0;
        }
        return r - 1;
      });
    }, 1000);

    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("fullscreenchange", onFsChange);
      document.removeEventListener("copy", onCopy);
      document.removeEventListener("paste", onPaste);
      document.removeEventListener("contextmenu", onContext);
      clearInterval(tick);
    };
  }, [started, result, flag, submit]);

  function startExam() {
    startedAtRef.current = Date.now();
    flagsRef.current = [];
    submittedRef.current = false;
    setRemaining(quiz?.exam?.timeLimitSec ?? null);
    setStarted(true);
    // Best-effort fullscreen on the user's click (browsers require a gesture).
    document.documentElement.requestFullscreen?.().catch(() => {});
  }

  // Fetch the answer key once, on demand (practice study aids only).
  const ensureKey = React.useCallback(async (): Promise<number[] | null> => {
    if (answerKey) return answerKey;
    const res = await fetch(`/api/quizzes/${quizId}/answers`, { cache: "no-store" }).catch(() => null);
    const j = res?.ok ? await res.json().catch(() => null) : null;
    if (Array.isArray(j?.correctIndexes)) {
      setAnswerKey(j.correctIndexes);
      return j.correctIndexes;
    }
    return null;
  }, [answerKey, quizId]);

  async function showAnswer(qi: number) {
    const key = await ensureKey();
    if (key) setShown((s) => new Set(s).add(qi));
  }

  async function toggleSheet() {
    if (!sheetOpen && !(await ensureKey())) return;
    setSheetOpen((v) => !v);
  }

  function retry() {
    setResult(null);
    setAnswers(new Array(quiz?.questions.length ?? 0).fill(-1));
    setShown(new Set());
    setSheetOpen(false);
  }

  if (err) return <div className="upload-card"><p className="dash-sub">Quiz not found.</p><Link className="btn" href={backHref}>← {backLabel}</Link></div>;
  if (!quiz) return <div className="upload-card"><p className="dash-sub">Loading...</p></div>;

  // Reporting is a review-time action, not an attempt-time one.
  //
  // Inside a live exam it is gone entirely. A free-text dialog in the middle of
  // a timed, fullscreen, proctored attempt is a channel none of the integrity
  // rules above cover, and every second in it is a second off a clock that
  // doesn't stop - which quietly makes reporting cost marks. Practice keeps the
  // quiz-level control while answering: a typo in a prompt is visible before
  // grading and nothing is at stake.
  //
  // Per QUESTION the control appears only once the marking does (see `perQ`).
  // Before submitting, "this answer is wrong" is a prediction; after, the
  // member is looking at the key that marked them, which is both the moment
  // they doubt it and the moment their report is worth acting on.
  const examInProgress = isExam && started && !result;
  const quizTarget = { kind: "quiz" as const, id: quizId, title: quiz.title };

  // Exam pre-start gate: instructions + integrity notice, then the taker starts
  // deliberately (which also grants the fullscreen gesture).
  if (isExam && !started && !result) {
    return (
      <div className="upload-card">
        <div className="study-head">
          <h1 className="upload-h">{quiz.title}</h1>
          <span className="exam-badge">Exam</span>
        </div>
        <div className="exam-brief">
          <p className="dash-sub">This is a timed, proctored exam.</p>
          <ul className="exam-brief-list">
            <li><strong>{quiz.questions.length}</strong> question{quiz.questions.length === 1 ? "" : "s"}</li>
            <li>Time limit: <strong>{fmtClock(quiz.exam!.timeLimitSec)}</strong> (auto-submits at zero)</li>
            <li>The exam runs in fullscreen. Leaving fullscreen, switching tabs, or losing focus is recorded.</li>
            <li>Answers are graded but not revealed. Repeated integrity flags can void your attempt.</li>
          </ul>
          <button type="button" className="cta" onClick={startExam}>Start exam</button>
        </div>
        <div className="study-foot">
          <ReportProblem target={quizTarget} />
          <Link className="dash-back" href={backHref}>← {backLabel}</Link>
        </div>
      </div>
    );
  }

  const answered = answers.filter((a) => a >= 0).length;
  const lowTime = remaining !== null && remaining <= 30;

  return (
    <div className="upload-card">
      <div className="study-head">
        <h1 className="upload-h">{quiz.title}</h1>
        {result ? (
          <span className="section-count">{result.score} / {result.total}</span>
        ) : isExam && remaining !== null ? (
          <span className={`exam-timer${lowTime ? " is-low" : ""}`} role="timer" aria-live="off">{fmtClock(remaining)}</span>
        ) : (
          <span className="section-count">{answered} / {quiz.questions.length} answered</span>
        )}
      </div>

      {/* Exam result: score only, plus a void notice. No per-question key. */}
      {result && isExam && (
        <div className={`exam-result${result.voided ? " is-voided" : ""}`} role="status">
          {result.voided
            ? "Submitted, but this attempt was flagged for review (possible integrity violation)."
            : "Submitted. Your exam has been recorded."}
        </div>
      )}

      {/* Study aids: practice mode only. */}
      {!result && !isExam && (
        <div className="quiz-study-bar">
          <label className="quiz-study-toggle">
            <input type="checkbox" checked={study} onChange={(e) => { setStudy(e.target.checked); if (!e.target.checked) setShown(new Set()); }} />
            <span>Study mode - reveal answers as you go</span>
          </label>
          <button type="button" className="btn" onClick={toggleSheet} aria-pressed={sheetOpen}>
            {sheetOpen ? "Hide answer sheet" : "Answer sheet"}
          </button>
        </div>
      )}

      {sheetOpen && answerKey && !isExam && (
        <div className="quiz-answer-sheet" role="region" aria-label="Answer sheet">
          <p className="quiz-answer-sheet-title">Answer sheet</p>
          <ol className="quiz-answer-sheet-list">
            {quiz.questions.map((q, qi) => (
              <li key={qi}>
                <span className="quiz-answer-sheet-q">{q.prompt || `Question ${qi + 1}`}</span>
                <span className="quiz-answer-sheet-a">{q.choices[answerKey[qi]]?.text || (q.choices[answerKey[qi]]?.imageId ? `Choice ${answerKey[qi] + 1} (image)` : "-")}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      <div className="quiz-take-list">
        {quiz.questions.map((q, qi) => {
          const picked = answers[qi];
          // Reveal is practice-only: after submit, or via "Show answer" in study
          // mode. Exam results carry no key, so nothing is revealed.
          const revealedKey = !isExam
            ? result
              ? result.correctIndexes?.[qi]
              : shown.has(qi)
                ? answerKey?.[qi]
                : undefined
            : undefined;
          const perQ = !isExam && result ? result.correct?.[qi] : undefined;
          return (
            <div key={qi} className={`quiz-take-q${perQ === undefined ? "" : perQ ? " is-correct" : " is-wrong"}`}>
              <p className="quiz-take-prompt">{qi + 1}. {q.prompt}{perQ === undefined ? "" : perQ ? "  (correct)" : "  (incorrect)"}</p>
              {q.promptImageId && (
                // eslint-disable-next-line @next/next/no-img-element
                <img className="quiz-take-image" src={`/api/images/${q.promptImageId}`} alt="" />
              )}
              <div className="quiz-take-choices">
                {q.choices.map((c, ci) => {
                  const isKey = revealedKey === ci;
                  const isPicked = picked === ci;
                  const cls = revealedKey !== undefined
                    ? `quiz-take-choice${isKey ? " key" : ""}${isPicked && !isKey ? " missed" : ""}`
                    : `quiz-take-choice${isPicked ? " picked" : ""}`;
                  return (
                    <label key={ci} className={cls}>
                      <input
                        type="radio"
                        name={`q-${qi}`}
                        disabled={Boolean(result)}
                        checked={isPicked}
                        onChange={() => setAnswers((a) => a.map((x, j) => (j === qi ? ci : x)))}
                      />
                      <span className="quiz-choice-body">
                        {c.imageId && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img className="quiz-choice-image" src={`/api/images/${c.imageId}`} alt="" />
                        )}
                        {c.text && <span>{c.text}</span>}
                      </span>
                    </label>
                  );
                })}
              </div>
              {study && !isExam && !result && !shown.has(qi) && (
                <button type="button" className="quiz-show-answer" onClick={() => showAnswer(qi)}>Show answer</button>
              )}
              {perQ !== undefined && (
                // In the same slot "Show answer" used while answering, so the
                // foot of a question card is always where its own actions are.
                // The number goes with it: a wrong key is a defect in question
                // 7, and an admin should not have to work out which one from
                // prose.
                <div style={{ marginTop: 8 }}>
                  <ReportProblem target={{ ...quizTarget, question: qi + 1 }} />
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="study-controls">
        {result ? (
          <>
            {!isExam && <button type="button" className="btn" onClick={retry}>Try again</button>}
            {/* Finishing means finishing: back to wherever this quiz was opened
                from, not the dashboard's default landing section. */}
            <Link className="btn primary" href={backHref}>Done · {backLabel}</Link>
          </>
        ) : isExam ? (
          <button type="button" className="cta" disabled={busy} onClick={() => submit(false)}>
            {busy ? "Submitting..." : answered !== quiz.questions.length ? `Submit exam (${answered}/${quiz.questions.length} answered)` : "Submit exam"}
          </button>
        ) : (
          <button type="button" className="cta" disabled={busy || answered !== quiz.questions.length} onClick={() => submit(false)}>
            {busy ? "Grading..." : answered !== quiz.questions.length ? `Answer all ${quiz.questions.length} to submit` : "Submit"}
          </button>
        )}
      </div>

      {/* The page's closing row: the rare secondary action, then the way out.
          Below study-controls and never inside it - Submit, Try again and Done
          own that row, and a report control there would be a fifth button
          competing with the one the member came to press. */}
      <div className="study-foot">
        {!examInProgress && <ReportProblem target={quizTarget} />}
        <Link className="dash-back" href={backHref}>← {backLabel}</Link>
      </div>
    </div>
  );
}
