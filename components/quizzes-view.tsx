"use client";

import Link from "next/link";
import * as React from "react";

import type { QuizMeta } from "@/lib/quizzes";
import { withBack } from "@/lib/return-to";
import { canEdit, canManageSharing } from "@/lib/visibility";

import { canAssign, useMe } from "./use-assignments";
import { useViewer } from "./use-viewer";

import { FavoriteButton } from "./favorite-button";
import { ShareDialog, type ShareTarget } from "./share-dialog";
import { useDashboardReturn } from "./use-return-to";

const VIS_LABEL = { public: "Public", chapter: "Chapter", private: "Private" } as const;

export function QuizzesView() {
  const viewer = useViewer();
  const me = useMe();
  // Presentation only — /api/quizzes/[id]/attempts re-decides against the
  // signed session and filters the rows, so this can never widen anything.
  const isStaff = canAssign(me?.role);
  // Everything this list opens carries the way back to it (role + section
  // included), so finishing a quiz returns here instead of the dashboard's
  // default landing section.
  const backHref = useDashboardReturn("quizzes");
  const [quizzes, setQuizzes] = React.useState<QuizMeta[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState(false);
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

  // A failed load used to fall through to quizzes = [], which renders as "No
  // quizzes yet - create the first one": an outage told as the fact that you
  // have written none.
  const load = React.useCallback(async () => {
    const res = await fetch("/api/quizzes", { cache: "no-store" }).catch(() => null);
    if (res?.ok) {
      setQuizzes((await res.json()).quizzes);
      setLoadError(false);
    } else {
      setLoadError(true);
    }
    setLoading(false);
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  React.useEffect(() => { void load(); }, [load]);

  // Not optimistic: the tile used to disappear on click and quietly come back
  // if the server refused, which reads as the list glitching rather than the
  // delete being denied. The quiz stays until the server confirms.
  async function del(id: string) {
    if (busyId) return;
    if (typeof window !== "undefined" && !window.confirm("Delete this quiz?")) return;
    setBusyId(id);
    const res = await fetch(`/api/quizzes/${id}`, { method: "DELETE" }).catch(() => null);
    setBusyId(null);
    if (!res?.ok) {
      setFlash("Couldn't delete that quiz. It's still here.");
      return;
    }
    setQuizzes((q) => q.filter((x) => x.id !== id));
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
        <Link className="cta" href={withBack("/upload?type=quiz", backHref)}>+ Create quiz</Link>
      </div>
      <p className="dash-sub" style={{ marginTop: -4, marginBottom: 12 }}>
        Self-test quizzes with Google-Docs-style sharing: copy anything you can see, edit
        what you own, share with specific people. Graded FLC exams live in the main HOSA platform.
      </p>
      {flash && <p className="dash-sub" role="status" style={{ marginBottom: 12 }}>{flash}</p>}
      {loading ? (
        <div className="empty-state">Loading...</div>
      ) : loadError ? (
        <div className="empty-state">
          Couldn&apos;t load your quizzes. <button type="button" className="btn" onClick={() => void load()}>Retry</button>
        </div>
      ) : quizzes.length === 0 ? (
        <div className="empty-state">No quizzes yet - create the first one.</div>
      ) : (
        <div className="tile-grid">
          {quizzes.map((q) => {
            const editable = q.id !== "sample-quiz" && canEdit(q, viewer);
            const canShare = q.id !== "sample-quiz" && canManageSharing(q, viewer);
            const mine = q.owner === viewer.owner;
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
                  <FavoriteButton id={q.id} label={q.title} />
                </div>
                <div className="tile-info">
                  <p className="tile-title">{q.title}</p>
                  <p className="tile-sub">
                    {q.isExam && <span className="exam-badge" style={{ marginRight: 6 }}>Exam</span>}
                    {q.questionCount} question{q.questionCount === 1 ? "" : "s"}
                    {" · "}
                    {q.owner === "system" ? "HOSA sample" : mine ? "Yours" : `By ${q.owner}`}
                    {q.people.length > 0 ? ` · shared with ${q.people.length}` : ""}
                  </p>
                </div>
                <div className="tile-actions">
                  <Link className="btn primary" href={withBack(`/quizzes/${q.id}`, backHref)}>Take</Link>
                  {editable && <Link className="btn" href={withBack(`/quizzes/${q.id}/edit`, backHref)}>Edit</Link>}
                  {/* Attempts used to be owner-only, which meant a trainer had
                      no way in on HOSA-authored exams — the ones their students
                      actually sit. Chapter staff get the link too; the route
                      then filters to their own chapter's takers, so following
                      it on someone else's quiz shows their members and nobody
                      else's. */}
                  {(mine || isStaff) && q.isExam && <Link className="btn" href={withBack(`/quizzes/${q.id}/attempts`, backHref)}>Attempts</Link>}
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
