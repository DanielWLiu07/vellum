"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";

import { RETURN_TO, returnLabel, withBack } from "@/lib/return-to";
import type { Visibility } from "@/lib/visibility";

import { ImageField } from "./image-field";
import { useAutosave, type SaveStatus } from "./use-autosave";

const VISIBILITY_OPTIONS: { id: Visibility; label: string }[] = [
  { id: "private", label: "Private - just me (draft)" },
  { id: "chapter", label: "My chapter" },
  { id: "public", label: "Everyone (shared pool)" },
];

type Choice = { text: string; imageId?: string };
type Q = { prompt: string; choices: Choice[]; correctIndex: number; promptImageId?: string };

const blankQ = (): Q => ({ prompt: "", choices: [{ text: "" }, { text: "" }], correctIndex: 0 });
const usableChoice = (c: Choice) => Boolean(c.text.trim() || c.imageId);
const ready = (q: Q) => (q.prompt.trim() || q.promptImageId) && q.choices.filter(usableChoice).length >= 2;

/**
 * Create a quiz, or — with `editId` — edit an existing one in place. Edit mode
 * loads the full quiz INCLUDING the answer key via `?edit=1`, which the server
 * only serves to the owner or a granted editor.
 */
export function QuizEditor({ editId, backHref = RETURN_TO.quizzes, selfHref }: {
  editId?: string;
  /** Validated destination for "Done" and for the quiz this editor creates. */
  backHref?: string;
  /** This editor's own URL, handed to preview links so they come back here. */
  selfHref?: string;
} = {}) {
  const backLabel = returnLabel(backHref);
  const [title, setTitle] = React.useState("");
  const [questions, setQuestions] = React.useState<Q[]>([blankQ()]);
  const [visibility, setVisibility] = React.useState<Visibility>("private");
  // Exam mode: timed, locked-down assessment (see ExamSettings server-side).
  const [examOn, setExamOn] = React.useState(false);
  const [examMin, setExamMin] = React.useState(30);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [editState, setEditState] = React.useState<"ready" | "loading" | "denied">(editId ? "loading" : "ready");
  const router = useRouter();

  // Edit mode is live: changes autosave, no save button. Saves title + the
  // usable questions (possibly empty) so title edits and deletions persist.
  const saveAbort = React.useRef<AbortController | null>(null);
  async function autosaveNow(): Promise<boolean> {
    const usable = questions.filter(ready);
    saveAbort.current?.abort();
    const ctrl = new AbortController();
    saveAbort.current = ctrl;
    try {
      const res = await fetch(`/api/quizzes/${editId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, questions: usable, exam: examOn ? { timeLimitSec: examMin * 60 } : null }),
        signal: ctrl.signal,
        keepalive: true,
      });
      if (res.ok) { setError(null); return true; }
      const j = await res.json().catch(() => null);
      setError(
        j?.error === "content_flagged"
          ? `Content moderation flagged this quiz${Array.isArray(j.categories) && j.categories.length ? ` (${j.categories.join(", ")})` : ""}. Fix it to keep saving.`
          : "Couldn't save your changes.",
      );
      return false;
    } catch (e) {
      if ((e as Error)?.name === "AbortError") return true; // superseded by a newer save
      setError("Couldn't save your changes.");
      return false;
    }
  }
  const status = useAutosave(autosaveNow, JSON.stringify({ title, questions: questions.filter(ready), examOn, examMin }), {
    enabled: Boolean(editId) && editState === "ready",
  });

  // Edit mode: load the existing quiz (with the answer key) into the form.
  React.useEffect(() => {
    if (!editId) return;
    let cancelled = false;
    (async () => {
      const res = await fetch(`/api/quizzes/${editId}?edit=1`, { cache: "no-store" }).catch(() => null);
      const j = res?.ok ? await res.json().catch(() => null) : null;
      if (cancelled) return;
      if (!j?.quiz?.questions) {
        setEditState("denied");
        return;
      }
      setTitle(j.quiz.title);
      if (j.quiz.exam && Number.isFinite(j.quiz.exam.timeLimitSec)) {
        setExamOn(true);
        setExamMin(Math.max(1, Math.round(j.quiz.exam.timeLimitSec / 60)));
      }
      const loaded = (j.quiz.questions as Q[]).map((q) => {
        const choices = (Array.isArray(q.choices) ? q.choices : []).map((c) =>
          typeof c === "string" ? { text: c } : { text: c?.text ?? "", ...(c?.imageId ? { imageId: c.imageId } : {}) },
        );
        return {
          prompt: q.prompt ?? "",
          choices: choices.length >= 2 ? choices : [{ text: "" }, { text: "" }],
          correctIndex: q.correctIndex ?? 0,
          promptImageId: q.promptImageId,
        };
      });
      // A fresh draft has no questions yet - show one blank to start.
      setQuestions(loaded.length ? loaded : [blankQ()]);
      setEditState("ready");
    })();
    return () => {
      cancelled = true;
    };
  }, [editId]);

  const patch = (i: number, p: Partial<Q>) => setQuestions((qs) => qs.map((q, j) => (j === i ? { ...q, ...p } : q)));
  const addQuestion = () => setQuestions((qs) => [...qs, blankQ()]);
  const removeQuestion = (i: number) => setQuestions((qs) => (qs.length > 1 ? qs.filter((_, j) => j !== i) : qs));
  const setChoice = (qi: number, ci: number, val: string) =>
    patch(qi, { choices: questions[qi]!.choices.map((c, j) => (j === ci ? { ...c, text: val } : c)) });
  const setChoiceImage = (qi: number, ci: number, id: string | undefined) =>
    patch(qi, { choices: questions[qi]!.choices.map((c, j) => (j === ci ? { ...c, imageId: id } : c)) });
  const addChoice = (qi: number) => patch(qi, { choices: [...questions[qi]!.choices, { text: "" }] });
  const removeChoice = (qi: number) => {
    const q = questions[qi]!;
    if (q.choices.length <= 2) return;
    const choices = q.choices.slice(0, -1);
    patch(qi, { choices, correctIndex: Math.min(q.correctIndex, choices.length - 1) });
  };

  // Create: make an (empty) quiz with its settings, then drop the user INTO
  // its live editor to add questions.
  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      setError("Give your quiz a name.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/quizzes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, questions: [], visibility }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        setError(
          j?.error === "content_flagged"
            ? `Content moderation flagged this quiz${Array.isArray(j.categories) && j.categories.length ? ` (${j.categories.join(", ")})` : ""}. Please revise it.`
            : "Couldn't create the quiz.",
        );
        return;
      }
      const doc = await res.json();
      // Into the new quiz's editor, still carrying the list this flow started
      // from — "Done" in there returns to it rather than to a blank form.
      router.push(withBack(`/quizzes/${doc.id}/edit`, backHref));
    } finally {
      setBusy(false);
    }
  }

  if (editState === "loading") {
    return <div className="upload-card"><p className="dash-sub">Loading the quiz...</p></div>;
  }
  if (editState === "denied") {
    return (
      <div className="upload-card">
        <h1 className="upload-h">Can&apos;t edit this quiz</h1>
        <p className="dash-sub">It doesn&apos;t exist, or you don&apos;t have editor access. Ask the owner to add you as an editor, or make a copy instead.</p>
        <div className="upload-actions"><Link className="btn" href={backHref}>← {backLabel}</Link></div>
      </div>
    );
  }

  // CREATE: name it + choose visibility, then go inside to add questions.
  if (!editId) {
    return (
      <form className="upload-card" onSubmit={create}>
        <h1 className="upload-h">New quiz</h1>
        <p className="dash-sub">Name it and choose who can see it. You&apos;ll add questions next.</p>
        <label className="dash-field"><span>Quiz title</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Anatomy unit 2" maxLength={120} autoFocus /></label>
        <label className="dash-field"><span>Who can see it</span>
          <select value={visibility} onChange={(e) => setVisibility(e.target.value as Visibility)}>
            {VISIBILITY_OPTIONS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select></label>
        {error && <p className="upload-error" role="alert">{error}</p>}
        <div>
          <button type="submit" className="cta" disabled={busy || !title.trim()}>
            {busy ? "Creating..." : "Create & add questions"}
          </button>
        </div>
      </form>
    );
  }

  const count = questions.filter(ready).length;
  return (
    <form className="upload-card" onSubmit={(e) => e.preventDefault()}>
      <div className="editor-head">
        <h1 className="upload-h">{`Edit quiz${title ? `: ${title}` : ""}`}</h1>
        <SaveStatusChip status={status} />
      </div>
      <p className="dash-sub">
        Write multiple-choice questions and mark the correct answer. Changes save automatically.
        (Graded FLC exams live in the main HOSA platform.)
      </p>

      <label className="dash-field"><span>Quiz title</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Anatomy unit 2" maxLength={120} /></label>

      <div className="exam-settings">
        <label className="quiz-study-toggle">
          <input type="checkbox" checked={examOn} onChange={(e) => setExamOn(e.target.checked)} />
          <span>Exam mode - timed and locked down (no answer reveal, integrity flags recorded)</span>
        </label>
        {examOn && (
          <label className="exam-time-field">
            <span>Time limit</span>
            <input
              type="number"
              min={1}
              max={240}
              value={examMin}
              onChange={(e) => setExamMin(Math.max(1, Math.min(240, Number(e.target.value) || 1)))}
            />
            <span>minutes</span>
          </label>
        )}
        {examOn && (
          <p className="quiz-hint">
            Takers start in fullscreen; leaving fullscreen or switching tabs is flagged. Repeated flags auto-void the
            attempt for your review. Integrity is advisory (client-reported) - the fully proctored engine lives in the
            main HOSA platform.
          </p>
        )}
      </div>

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
            <div className="quiz-q-image">
              <ImageField id={q.promptImageId} onChange={(id) => patch(qi, { promptImageId: id })} label="question" addLabel="+ Add image" />
            </div>
            <div className="quiz-choices">
              {q.choices.map((c, ci) => (
                <div key={ci} className="quiz-choice-row">
                  <label className="quiz-choice">
                    <input
                      type="radio"
                      name={`correct-${qi}`}
                      checked={q.correctIndex === ci}
                      onChange={() => patch(qi, { correctIndex: ci })}
                      aria-label={`Mark choice ${ci + 1} correct`}
                    />
                    <input
                      className="card-input"
                      value={c.text}
                      onChange={(e) => setChoice(qi, ci, e.target.value)}
                      placeholder={`Choice ${ci + 1}${c.imageId ? " (optional caption)" : ""}`}
                      aria-label={`Question ${qi + 1} choice ${ci + 1}`}
                    />
                  </label>
                  <div className="quiz-choice-image-field">
                    <ImageField
                      id={c.imageId}
                      onChange={(id) => setChoiceImage(qi, ci, id)}
                      label={`choice ${ci + 1}`}
                      addLabel="+ Image"
                    />
                  </div>
                </div>
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
      <div className="upload-actions">
        <Link className="cta" href={withBack(`/quizzes/${editId}`, selfHref ?? backHref)}>Take it</Link>
        {examOn && <Link className="btn" href={withBack(`/quizzes/${editId}/attempts`, selfHref ?? backHref)}>Review attempts</Link>}
        <Link className="btn" href={backHref}>Done · {backLabel}</Link>
        <SaveStatusChip status={status} />
        <span className="dash-sub" style={{ marginLeft: "auto", fontSize: 13 }}>{count} question{count === 1 ? "" : "s"}</span>
      </div>
    </form>
  );
}

/** Live autosave status shown in the editor (edit mode). */
function SaveStatusChip({ status }: { status: SaveStatus }) {
  return (
    <span className={`save-status save-status-${status}`} aria-live="polite">
      {status === "saving" ? "Saving..." : status === "error" ? "Save failed" : "All changes saved"}
    </span>
  );
}
