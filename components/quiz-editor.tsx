"use client";

import Link from "next/link";
import * as React from "react";

type Q = { prompt: string; choices: string[]; correctIndex: number };

const blankQ = (): Q => ({ prompt: "", choices: ["", ""], correctIndex: 0 });
const ready = (q: Q) => q.prompt.trim() && q.choices.filter((c) => c.trim()).length >= 2;

export function QuizEditor() {
  const [title, setTitle] = React.useState("");
  const [questions, setQuestions] = React.useState<Q[]>([blankQ()]);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState<{ id: string; title: string; questionCount: number } | null>(null);

  const patch = (i: number, p: Partial<Q>) => setQuestions((qs) => qs.map((q, j) => (j === i ? { ...q, ...p } : q)));
  const addQuestion = () => setQuestions((qs) => [...qs, blankQ()]);
  const removeQuestion = (i: number) => setQuestions((qs) => (qs.length > 1 ? qs.filter((_, j) => j !== i) : qs));
  const setChoice = (qi: number, ci: number, val: string) =>
    patch(qi, { choices: questions[qi]!.choices.map((c, j) => (j === ci ? val : c)) });
  const addChoice = (qi: number) => patch(qi, { choices: [...questions[qi]!.choices, ""] });
  const removeChoice = (qi: number) => {
    const q = questions[qi]!;
    if (q.choices.length <= 2) return;
    const choices = q.choices.slice(0, -1);
    patch(qi, { choices, correctIndex: Math.min(q.correctIndex, choices.length - 1) });
  };

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const usable = questions.filter(ready);
    if (usable.length === 0) {
      setError("Add at least one question with a prompt and two or more choices.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/quizzes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, questions: usable }),
      });
      if (!res.ok) {
        setError("Couldn't save the quiz.");
        return;
      }
      setSaved(await res.json());
    } finally {
      setBusy(false);
    }
  }

  if (saved) {
    return (
      <div className="upload-card">
        <span className="pill">Created</span>
        <h1 className="upload-h">{saved.title} - {saved.questionCount} question{saved.questionCount === 1 ? "" : "s"}</h1>
        <p className="dash-sub">Your quiz is in the shared pool. Anyone in your chapter can take it.</p>
        <div className="upload-actions">
          <Link className="cta" href={`/quizzes/${saved.id}`}>Take it</Link>
          <Link className="btn" href="/dashboard">Back to dashboard</Link>
        </div>
      </div>
    );
  }

  const count = questions.filter(ready).length;
  return (
    <form className="upload-card" onSubmit={save}>
      <h1 className="upload-h">Create a quiz</h1>
      <p className="dash-sub">
        Write multiple-choice questions and mark the correct answer. It joins the shared pool for
        self-testing. (Graded FLC exams live in the main HOSA platform.)
      </p>

      <label className="dash-field"><span>Quiz title</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Anatomy unit 2" maxLength={120} /></label>

      <div className="card-edit-list">
        {questions.map((q, qi) => (
          <div key={qi} className="card-edit">
            <div className="card-edit-head">
              <span className="card-edit-num">Question {qi + 1}</span>
              <button type="button" className="card-edit-remove" onClick={() => removeQuestion(qi)}>Remove</button>
            </div>
            <input
              className="card-input"
              value={q.prompt}
              onChange={(e) => patch(qi, { prompt: e.target.value })}
              placeholder="Question prompt"
              aria-label={`Question ${qi + 1} prompt`}
              style={{ width: "100%", marginBottom: 8 }}
            />
            <div className="quiz-choices">
              {q.choices.map((c, ci) => (
                <label key={ci} className="quiz-choice">
                  <input
                    type="radio"
                    name={`correct-${qi}`}
                    checked={q.correctIndex === ci}
                    onChange={() => patch(qi, { correctIndex: ci })}
                    aria-label={`Mark choice ${ci + 1} correct`}
                  />
                  <input
                    className="card-input"
                    value={c}
                    onChange={(e) => setChoice(qi, ci, e.target.value)}
                    placeholder={`Choice ${ci + 1}`}
                    aria-label={`Question ${qi + 1} choice ${ci + 1}`}
                  />
                </label>
              ))}
              <div className="quiz-choice-actions">
                <button type="button" className="btn" onClick={() => addChoice(qi)}>+ Choice</button>
                {q.choices.length > 2 && <button type="button" className="btn" onClick={() => removeChoice(qi)}>- Choice</button>}
              </div>
              <p className="quiz-hint">Select the radio next to the correct answer.</p>
            </div>
          </div>
        ))}
        <div><button type="button" className="btn" onClick={addQuestion}>+ Add question</button></div>
      </div>

      {error && <p className="upload-error" role="alert">{error}</p>}
      <div>
        <button type="submit" className="cta" disabled={busy || count === 0}>
          {busy ? "Saving..." : `Create quiz (${count} question${count === 1 ? "" : "s"})`}
        </button>
      </div>
    </form>
  );
}
