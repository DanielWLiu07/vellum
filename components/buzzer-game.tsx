"use client";

import * as React from "react";

import { BUZZER_TIME_SEC, scoreQuestion, shuffle, summarize, type BuzzerOutcome } from "@/lib/buzzer";

type Choice = { text: string; imageId?: string };
type Question = { prompt: string; choices: Choice[]; promptImageId?: string };
type PlayItem = Question & { correctIndex: number };
type QuizMeta = { id: string; title: string; questionCount: number; isExam: boolean };

// ---- Lobby: pick a quiz to drill as a rapid buzzer round --------------------

export function SkillsView() {
  const [quizzes, setQuizzes] = React.useState<QuizMeta[] | null>(null);
  const [selected, setSelected] = React.useState<QuizMeta | null>(null);

  React.useEffect(() => {
    let live = true;
    fetch("/api/quizzes", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (live && Array.isArray(j?.quizzes)) setQuizzes(j.quizzes);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  if (selected) return <BuzzerGame quiz={selected} onExit={() => setSelected(null)} />;

  // Only practice quizzes with questions can be drilled - exams withhold their
  // answer key, which the buzzer round needs for instant scoring.
  const playable = (quizzes ?? []).filter((q) => !q.isExam && q.questionCount > 0);

  return (
    <section className="role-section">
      <div className="section-head">
        <h2>General skills</h2>
        <span className="section-count">Round-2 practice</span>
      </div>
      <p className="dash-sub">
        Rapid buzzer rounds: the faster you lock in the right answer, the more points. Pick a quiz to drill.
      </p>
      {quizzes === null ? (
        <div className="empty-state">Loading...</div>
      ) : playable.length === 0 ? (
        <div className="empty-state">No practice quizzes to drill yet. Create a quiz (not an exam) to play a buzzer round.</div>
      ) : (
        <div className="tile-grid">
          {playable.map((q) => (
            <div key={q.id} className="tile">
              <div className="tile-info">
                <p className="tile-title">{q.title}</p>
                <p className="tile-sub">{q.questionCount} question{q.questionCount === 1 ? "" : "s"}</p>
              </div>
              <div className="tile-actions">
                <button type="button" className="btn primary" onClick={() => setSelected(q)}>Start round</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ---- The buzzer round --------------------------------------------------------

type Status = "loading" | "error" | "running" | "reveal" | "done";

function BuzzerGame({ quiz, onExit }: { quiz: QuizMeta; onExit: () => void }) {
  const [source, setSource] = React.useState<PlayItem[] | null>(null);
  const [items, setItems] = React.useState<PlayItem[]>([]);
  const [status, setStatus] = React.useState<Status>("loading");
  const [idx, setIdx] = React.useState(0);
  const [secondsLeft, setSecondsLeft] = React.useState(BUZZER_TIME_SEC);
  const [picked, setPicked] = React.useState<number | null>(null);
  const [outcomes, setOutcomes] = React.useState<BuzzerOutcome[]>([]);

  // Refs so the timer callback + lock can read live question state without
  // re-subscribing, and so a click and a timeout can't both score one question.
  const itemsRef = React.useRef<PlayItem[]>([]);
  const idxRef = React.useRef(0);
  const lockedRef = React.useRef(false);

  // Load the questions (taker view, no answers) + the answer key (practice
  // quizzes serve it), zip them, and shuffle into a round.
  React.useEffect(() => {
    let live = true;
    (async () => {
      const [qRes, kRes] = await Promise.all([
        fetch(`/api/quizzes/${quiz.id}`, { cache: "no-store" }).catch(() => null),
        fetch(`/api/quizzes/${quiz.id}/answers`, { cache: "no-store" }).catch(() => null),
      ]);
      if (!live) return;
      const q = qRes?.ok ? await qRes.json().catch(() => null) : null;
      const k = kRes?.ok ? await kRes.json().catch(() => null) : null;
      const questions: Question[] = q?.quiz?.questions ?? [];
      const key: number[] = k?.correctIndexes ?? [];
      if (!questions.length || key.length !== questions.length) {
        setStatus("error");
        return;
      }
      const zipped: PlayItem[] = questions.map((question, i) => ({ ...question, correctIndex: key[i]! }));
      const round = shuffle(zipped);
      setSource(zipped);
      setItems(round);
      itemsRef.current = round;
      idxRef.current = 0;
      lockedRef.current = false;
      setStatus("running");
    })();
    return () => {
      live = false;
    };
  }, [quiz.id]);

  // Lock in an answer (a click) or a miss (null, on timeout). Guarded so the
  // two can't both fire for one question. Reads live question via refs.
  const lockIn = React.useCallback((choice: number | null, secsLeft: number) => {
    if (lockedRef.current) return;
    lockedRef.current = true;
    const item = itemsRef.current[idxRef.current];
    const correct = choice !== null && !!item && choice === item.correctIndex;
    setPicked(choice);
    setOutcomes((o) => [...o, { correct, points: scoreQuestion(correct, secsLeft) }]);
    setStatus("reveal");
  }, []);

  // Countdown while a question is live; the timeout is handled inside the timer
  // callback (not the effect body) so it can't cascade renders.
  React.useEffect(() => {
    if (status !== "running") return;
    const t = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          clearInterval(t);
          queueMicrotask(() => lockIn(null, 0)); // time's up -> a miss
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [status, idx, lockIn]);

  // After the reveal beat, advance (or finish).
  React.useEffect(() => {
    if (status !== "reveal") return;
    const t = setTimeout(() => {
      if (idxRef.current + 1 >= itemsRef.current.length) {
        setStatus("done");
        return;
      }
      idxRef.current += 1;
      lockedRef.current = false;
      setIdx(idxRef.current);
      setPicked(null);
      setSecondsLeft(BUZZER_TIME_SEC);
      setStatus("running");
    }, 1300);
    return () => clearTimeout(t);
  }, [status]);

  function playAgain() {
    if (!source) return;
    const round = shuffle(source);
    setItems(round);
    itemsRef.current = round;
    idxRef.current = 0;
    lockedRef.current = false;
    setIdx(0);
    setPicked(null);
    setOutcomes([]);
    setSecondsLeft(BUZZER_TIME_SEC);
    setStatus("running");
  }

  if (status === "loading") return <div className="upload-card"><p className="dash-sub">Loading round...</p></div>;
  if (status === "error") {
    return (
      <div className="upload-card">
        <p className="dash-sub">Couldn&apos;t start this round. It may be an exam (answers withheld) or have no questions.</p>
        <button type="button" className="btn" onClick={onExit}>Back to games</button>
      </div>
    );
  }

  const runningPoints = outcomes.reduce((s, o) => s + o.points, 0);
  let streak = 0;
  for (let i = outcomes.length - 1; i >= 0 && outcomes[i]!.correct; i--) streak++;

  if (status === "done") {
    const s = summarize(outcomes);
    return (
      <div className="upload-card">
        <div className="study-head">
          <h1 className="upload-h">{quiz.title}</h1>
          <span className="section-count">Round complete</span>
        </div>
        <div className="buzzer-scoreboard">
          <div className="buzzer-stat"><span className="buzzer-stat-value">{s.points}</span><span className="buzzer-stat-label">Points</span></div>
          <div className="buzzer-stat"><span className="buzzer-stat-value">{s.correct}/{s.total}</span><span className="buzzer-stat-label">Correct</span></div>
          <div className="buzzer-stat"><span className="buzzer-stat-value">{s.accuracy}%</span><span className="buzzer-stat-label">Accuracy</span></div>
          <div className="buzzer-stat"><span className="buzzer-stat-value">{s.bestStreak}</span><span className="buzzer-stat-label">Best streak</span></div>
        </div>
        <div className="study-controls">
          <button type="button" className="cta" onClick={playAgain}>Play again</button>
          <button type="button" className="btn" onClick={onExit}>Back to games</button>
        </div>
      </div>
    );
  }

  const item = items[idx]!;
  const low = secondsLeft <= 5;
  return (
    <div className="upload-card">
      <div className="buzzer-hud">
        <span className="buzzer-progress">Q{idx + 1} / {items.length}</span>
        <span className={`buzzer-timer${low ? " is-low" : ""}`} role="timer" aria-live="off">{Math.max(0, secondsLeft)}</span>
        <span className="buzzer-score">{runningPoints} pts{streak >= 2 ? ` · ${streak} streak` : ""}</span>
      </div>

      <p className="buzzer-prompt">{item.prompt}</p>
      {item.promptImageId && (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="quiz-take-image" src={`/api/images/${item.promptImageId}`} alt="" />
      )}

      <div className="buzzer-choices">
        {item.choices.map((c, ci) => {
          const revealing = status === "reveal";
          const isKey = ci === item.correctIndex;
          const isPicked = ci === picked;
          const cls = revealing
            ? `buzzer-choice${isKey ? " key" : ""}${isPicked && !isKey ? " missed" : ""}`
            : "buzzer-choice";
          return (
            <button
              key={ci}
              type="button"
              className={cls}
              disabled={status !== "running"}
              onClick={() => lockIn(ci, secondsLeft)}
            >
              {c.imageId && (
                // eslint-disable-next-line @next/next/no-img-element
                <img className="quiz-choice-image" src={`/api/images/${c.imageId}`} alt="" />
              )}
              {c.text && <span>{c.text}</span>}
            </button>
          );
        })}
      </div>

      {status === "reveal" && (
        <p className={`buzzer-feedback${outcomes[outcomes.length - 1]?.correct ? " is-correct" : " is-wrong"}`} role="status">
          {outcomes[outcomes.length - 1]?.correct
            ? `Correct! +${outcomes[outcomes.length - 1]?.points}`
            : picked === null
              ? "Time's up"
              : "Missed"}
        </p>
      )}

      <button type="button" className="dash-back" onClick={onExit}>Quit round</button>
    </div>
  );
}
