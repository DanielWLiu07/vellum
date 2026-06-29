"use client";

import Link from "next/link";
import * as React from "react";

import type { QuizMeta } from "@/lib/quizzes";

export function QuizzesView() {
  const [quizzes, setQuizzes] = React.useState<QuizMeta[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [busyId, setBusyId] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    const res = await fetch("/api/quizzes", { cache: "no-store" }).catch(() => null);
    if (res?.ok) setQuizzes((await res.json()).quizzes);
    setLoading(false);
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  React.useEffect(() => { void load(); }, [load]);

  async function del(id: string) {
    if (busyId) return;
    if (typeof window !== "undefined" && !window.confirm("Delete this quiz?")) return;
    setBusyId(id);
    setQuizzes((q) => q.filter((x) => x.id !== id));
    const res = await fetch(`/api/quizzes/${id}`, { method: "DELETE" }).catch(() => null);
    if (!res?.ok) await load();
    setBusyId(null);
  }

  return (
    <section className="role-section">
      <div className="section-head">
        <h2>Quizzes</h2>
        <Link className="cta" href="/upload?type=quiz">+ Create quiz</Link>
      </div>
      <p className="dash-sub" style={{ marginTop: -4, marginBottom: 12 }}>
        Shared multiple-choice quizzes for self-testing. Graded FLC exams live in the main HOSA platform.
      </p>
      {loading ? (
        <div className="empty-state">Loading...</div>
      ) : quizzes.length === 0 ? (
        <div className="empty-state">No quizzes yet - create the first one.</div>
      ) : (
        <div className="tile-grid">
          {quizzes.map((q) => (
            <div key={q.id} className="tile" data-testid={`quiz-${q.id}`}>
              <div className="tile-thumb">
                <div className="tile-preview">
                  <span className="tile-preview-title">{q.title}</span>
                  <span className="tile-line" />
                  <span className="tile-line short" />
                </div>
              </div>
              <div className="tile-info">
                <p className="tile-title">{q.title}</p>
                <p className="tile-sub">{q.questionCount} question{q.questionCount === 1 ? "" : "s"}</p>
              </div>
              <div className="tile-actions">
                <Link className="btn primary" href={`/quizzes/${q.id}`}>Take</Link>
                {q.id !== "sample-quiz" && (
                  <button type="button" className="btn" disabled={busyId === q.id} onClick={() => del(q.id)}>Delete</button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
