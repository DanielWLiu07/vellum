"use client";

import Link from "next/link";
import * as React from "react";

type TakerQuiz = { id: string; title: string; questions: { prompt: string; choices: string[] }[] };
type Result = { score: number; total: number; correct: boolean[]; correctIndexes: number[] };

export function QuizTake({ quizId }: { quizId: string }) {
  const [quiz, setQuiz] = React.useState<TakerQuiz | null>(null);
  const [err, setErr] = React.useState(false);
  const [answers, setAnswers] = React.useState<number[]>([]);
  const [result, setResult] = React.useState<Result | null>(null);
  const [busy, setBusy] = React.useState(false);

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

  async function submit() {
    setBusy(true);
    try {
      const res = await fetch(`/api/quizzes/${quizId}/grade`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers }),
      });
      if (res.ok) setResult(await res.json());
    } finally {
      setBusy(false);
    }
  }

  function retry() {
    setResult(null);
    setAnswers(new Array(quiz?.questions.length ?? 0).fill(-1));
  }

  if (err) return <div className="upload-card"><p className="dash-sub">Quiz not found.</p><Link className="btn" href="/dashboard">Back to dashboard</Link></div>;
  if (!quiz) return <div className="upload-card"><p className="dash-sub">Loading...</p></div>;

  const answered = answers.filter((a) => a >= 0).length;

  return (
    <div className="upload-card">
      <div className="study-head">
        <h1 className="upload-h">{quiz.title}</h1>
        {result
          ? <span className="section-count">{result.score} / {result.total}</span>
          : <span className="section-count">{answered} / {quiz.questions.length} answered</span>}
      </div>

      <div className="quiz-take-list">
        {quiz.questions.map((q, qi) => {
          const picked = result ? answers[qi] : answers[qi];
          const key = result?.correctIndexes[qi];
          return (
            <div key={qi} className={`quiz-take-q${result ? (result.correct[qi] ? " is-correct" : " is-wrong") : ""}`}>
              <p className="quiz-take-prompt">{qi + 1}. {q.prompt}{result ? (result.correct[qi] ? "  (correct)" : "  (incorrect)") : ""}</p>
              <div className="quiz-take-choices">
                {q.choices.map((c, ci) => {
                  const isKey = result && key === ci;
                  const isPicked = picked === ci;
                  const cls = result
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
                      <span>{c}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      <div className="study-controls">
        {result ? (
          <>
            <button type="button" className="btn" onClick={retry}>Try again</button>
            <Link className="btn primary" href="/dashboard">Done</Link>
          </>
        ) : (
          <button type="button" className="cta" disabled={busy} onClick={submit}>
            {busy ? "Grading..." : "Submit"}
          </button>
        )}
      </div>

      <Link className="dash-back" href="/dashboard">← Back to dashboard</Link>
    </div>
  );
}
