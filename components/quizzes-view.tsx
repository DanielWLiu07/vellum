"use client";

import Link from "next/link";
import * as React from "react";

import type { QuizMeta } from "@/lib/quizzes";
import { DEMO_VIEWER, canEdit, canManageSharing } from "@/lib/visibility";

import { ShareDialog, type ShareTarget } from "./share-dialog";

const VIS_LABEL = { public: "Public", chapter: "Chapter", private: "Private" } as const;

export function QuizzesView() {
  const [quizzes, setQuizzes] = React.useState<QuizMeta[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [share, setShare] = React.useState<ShareTarget | null>(null);
  const [flash, setFlashMsg] = React.useState<string | null>(null);
  const flashTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  // Transient status line that clears itself (review finding: banners piled up).
  const setFlash = React.useCallback((msg: string) => {
    setFlashMsg(msg);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlashMsg(null), 4000);
  }, []);
  React.useEffect(() => () => { if (flashTimer.current) clearTimeout(flashTimer.current); }, []);

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

  async function copy(q: QuizMeta) {
    if (busyId) return;
    setBusyId(q.id);
    const res = await fetch(`/api/quizzes/${q.id}/copy`, { method: "POST" }).catch(() => null);
    if (res?.ok) {
      const j = await res.json();
      setFlash(`Created "${j.title}" (private) - it's yours to edit.`);
      await load();
    } else {
      setFlash("Couldn't copy the quiz.");
    }
    setBusyId(null);
  }

  return (
    <section className="role-section">
      <div className="section-head">
        <h2>Quizzes</h2>
        <Link className="cta" href="/upload?type=quiz">+ Create quiz</Link>
      </div>
      <p className="dash-sub" style={{ marginTop: -4, marginBottom: 12 }}>
        Self-test quizzes with Google-Docs-style sharing: copy anything you can see, edit
        what you own, share with specific people. Graded FLC exams live in the main HOSA platform.
      </p>
      {flash && <p className="dash-sub" role="status" style={{ marginBottom: 12 }}>{flash}</p>}
      {loading ? (
        <div className="empty-state">Loading...</div>
      ) : quizzes.length === 0 ? (
        <div className="empty-state">No quizzes yet - create the first one.</div>
      ) : (
        <div className="tile-grid">
          {quizzes.map((q) => {
            const editable = q.id !== "sample-quiz" && canEdit(q, DEMO_VIEWER);
            const canShare = q.id !== "sample-quiz" && canManageSharing(q, DEMO_VIEWER);
            const mine = q.owner === DEMO_VIEWER.owner;
            return (
              <div key={q.id} className="tile" data-testid={`quiz-${q.id}`}>
                <div className="tile-thumb">
                  <div className="tile-preview">
                    <span className="tile-preview-title">{q.title}</span>
                    <span className="tile-line" />
                    <span className="tile-line short" />
                  </div>
                  <span className={`tile-badge badge-${q.visibility === "public" ? "ok" : q.visibility === "chapter" ? "warn" : "muted"}`}>
                    {VIS_LABEL[q.visibility]}
                  </span>
                </div>
                <div className="tile-info">
                  <p className="tile-title">{q.title}</p>
                  <p className="tile-sub">
                    {q.questionCount} question{q.questionCount === 1 ? "" : "s"}
                    {" · "}
                    {q.owner === "system" ? "HOSA sample" : mine ? "Yours" : `By ${q.owner}`}
                    {q.people.length > 0 ? ` · shared with ${q.people.length}` : ""}
                  </p>
                </div>
                <div className="tile-actions">
                  <Link className="btn primary" href={`/quizzes/${q.id}`}>Take</Link>
                  {editable && <Link className="btn" href={`/quizzes/${q.id}/edit`}>Edit</Link>}
                  <button type="button" className="btn" disabled={busyId === q.id} onClick={() => copy(q)}>Make a copy</button>
                  {canShare && (
                    <button
                      type="button"
                      className="btn"
                      onClick={() => setShare({ kind: "quiz", id: q.id, name: q.title, visibility: q.visibility, chapter: q.chapter, people: q.people, owner: q.owner })}
                    >
                      Share
                    </button>
                  )}
                  {mine && (
                    <button type="button" className="btn danger" disabled={busyId === q.id} onClick={() => del(q.id)}>Delete</button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {share && (
        <ShareDialog
          target={share}
          onClose={() => setShare(null)}
          onSaved={(m) => { setShare(null); setFlash(m); void load(); }}
        />
      )}
    </section>
  );
}
