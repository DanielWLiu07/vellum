"use client";

/**
 * A member's own exam results.
 *
 * Every attempt shown here was already being recorded; nothing ever showed it
 * to the person who earned it, because the only way to read attempts was the
 * quiz owner's review screen, and that has to stay owner-only (it carries
 * everybody's scores). This is the same data asked for the other way round.
 *
 * Grouped by quiz rather than listed flat so a retake reads as movement against
 * the last sitting instead of an unrelated score. The arithmetic and the wording
 * live in lib/quiz-attempts, tested there; this file is layout.
 */

import * as React from "react";

import { changeLabel, type MyAttempt, type MyQuizHistory } from "@/lib/quiz-history";

function dur(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m ? `${m}m ${s}s` : `${s}s`;
}

function when(ms: number): string {
  const s = Math.max(1, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export function MyAttempts() {
  const [quizzes, setQuizzes] = React.useState<MyQuizHistory[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let live = true;
    fetch("/api/my-attempts", { cache: "no-store" })
      .then(async (res) => {
        if (!live) return;
        if (!res.ok) {
          setError("Couldn't load your results.");
          return;
        }
        const j = await res.json().catch(() => null);
        if (live) setQuizzes(Array.isArray(j?.quizzes) ? j.quizzes : []);
      })
      .catch(() => {
        if (live) setError("Couldn't load your results.");
      });
    return () => {
      live = false;
    };
  }, []);

  const attempts = (quizzes ?? []).reduce((n, q) => n + q.attempts.length, 0);
  const anyVoided = (quizzes ?? []).some((q) => q.voided > 0);

  return (
    <section className="role-section">
      <div className="section-head">
        <h2>Your exam results</h2>
        {quizzes && quizzes.length > 0 && (
          <span className="section-count">
            {attempts} attempt{attempts === 1 ? "" : "s"} across {quizzes.length} exam
            {quizzes.length === 1 ? "" : "s"}
          </span>
        )}
      </div>

      {error ? (
        <div className="empty-state">{error}</div>
      ) : !quizzes ? (
        <div className="empty-state">Loading...</div>
      ) : quizzes.length === 0 ? (
        // Says why it is empty. Practice quizzes deliberately record nothing,
        // so without this a student who has taken plenty of them reads an empty
        // page as their results having been lost.
        <div className="empty-state">
          You haven&apos;t taken a timed exam yet. Practice quizzes aren&apos;t recorded — only
          exams are.
        </div>
      ) : (
        <>
          {anyVoided && (
            <p className="section-note">
              A voided attempt doesn&apos;t count toward your best or latest score. If you think
              one was voided in error, ask whoever set the exam — they can reinstate it.
            </p>
          )}
          <div className="attempt-list">
            {quizzes.map((q) => (
              <QuizHistoryCard key={q.quizId} quiz={q} />
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function QuizHistoryCard({ quiz }: { quiz: MyQuizHistory }) {
  const change = changeLabel(quiz.changePercent);
  return (
    <div className="attempt-row">
      <div className="attempt-head">
        <span className="attempt-who">
          {quiz.title}{" "}
          {/* The quiz is gone but the result isn't. Saying so is the difference
              between a stale title and a score the student can't place. */}
          {quiz.removed && <span className="badge badge-muted">No longer available</span>}
        </span>
        <span className="attempt-score">
          {quiz.latestPercent === null ? "Not counted" : `${quiz.latestPercent}%`}
        </span>
      </div>

      {quiz.latestPercent !== null && (
        <div className="member-progress">
          <div className="bar" aria-label={`${quiz.latestPercent}%`}>
            <div className="bar-fill" style={{ width: `${quiz.latestPercent}%` }} />
          </div>
          <span className="member-frac">Best {quiz.bestPercent}%</span>
        </div>
      )}

      <div className="attempt-meta">
        <span>
          {quiz.attempts.length} attempt{quiz.attempts.length === 1 ? "" : "s"}
        </span>
        {change && <span>{change}</span>}
        {quiz.voided > 0 && (
          <span>
            {quiz.voided} voided
            {quiz.counted === 0 ? " — nothing counts yet" : ""}
          </span>
        )}
      </div>

      <div className="table-card">
        {quiz.attempts.map((a) => (
          <AttemptRow key={a.id} attempt={a} />
        ))}
      </div>
    </div>
  );
}

function AttemptRow({ attempt }: { attempt: MyAttempt }) {
  return (
    <div className="member-row">
      <div className="member-id">
        <div>
          <p className="member-name">
            {attempt.voided && <span className="badge badge-warn">Voided</span>}{" "}
            {attempt.score} / {attempt.total}
          </p>
          <p className="member-email">
            {when(attempt.submittedAt)} · took {dur(attempt.durationSec)}
            {attempt.autoSubmitted ? " · time ran out" : ""}
          </p>
          {/* Being zeroed with no explanation is the thing this view exists to
              fix, so the reason is shown even when it is the blunt automatic
              one. What is NOT shown is the flag-by-flag timeline the reviewer
              sees — see MyAttempt in lib/quiz-attempts. */}
          {attempt.voided && (
            <p className="attempt-void-note">{attempt.voidReason ?? "This attempt was voided."}</p>
          )}
        </div>
      </div>
      <span className="member-frac">{attempt.percent}%</span>
    </div>
  );
}
