"use client";

import Link from "next/link";
import * as React from "react";

import type { QuizMeta } from "@/lib/quizzes";
import { withBack } from "@/lib/return-to";
import { canEdit, canManageSharing } from "@/lib/visibility";

import { AssignToPeople } from "./assign-to-people";
import { canAssign, useMe } from "./use-assignments";
import { useViewer } from "./use-viewer";

import { FavoriteButton } from "./favorite-button";
import { ShareDialog, type ShareTarget } from "./share-dialog";
import { useDashboardReturn } from "./use-return-to";

const VIS_LABEL = { public: "Public", chapter: "Chapter", private: "Private" } as const;

export function QuizzesView() {
  const viewer = useViewer();
  // Presentation-only mirror of the assign gate; the route re-decides.
  const mayAssign = canAssign(useMe()?.role);
  // Everything this list opens carries the way back to it (role + section
  // included), so finishing a quiz returns here instead of the dashboard's
  // default landing section.
  const backHref = useDashboardReturn("quizzes");
  const [quizzes, setQuizzes] = React.useState<QuizMeta[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState(false);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [share, setShare] = React.useState<ShareTarget | null>(null);
  const [assigning, setAssigning] = React.useState<QuizMeta | null>(null);
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

  // Practice self-tests only. Timed exams have their own section now — listing
  // them here too would put a countdown that auto-submits and can void your
  // attempt one indistinguishable tile away from a self-test, which is the
  // confusion Examinations exists to end. Narrowed by KIND; /api/quizzes has
  // already decided what this viewer may see.
  const practice = quizzes.filter((q) => !q.isExam);

  return (
    <section className="role-section">
      <div className="section-head">
        <h2>Quizzes</h2>
        <Link className="cta" href={withBack("/upload?type=quiz", backHref)}>+ Create quiz</Link>
      </div>
      <p className="dash-sub" style={{ marginTop: -4, marginBottom: 12 }}>
        Untimed practice self-tests, with Google-Docs-style sharing: copy anything you can
        see, edit what you own, share with specific people. Timed sittings are under
        Examinations. Graded FLC exams live in the main HOSA platform.
      </p>
      {flash && <p className="dash-sub" role="status" style={{ marginBottom: 12 }}>{flash}</p>}
      {loading ? (
        <div className="empty-state">Loading...</div>
      ) : loadError ? (
        <div className="empty-state">
          Couldn&apos;t load your quizzes. <button type="button" className="btn" onClick={() => void load()}>Retry</button>
        </div>
      ) : practice.length === 0 ? (
        // Distinguish "you have written none" from "the ones you have are all
        // exams, and they moved" — otherwise a member who set up three exams
        // opens this page to a blank slate that reads as data loss.
        <div className="empty-state">
          {quizzes.length === 0
            ? "No quizzes yet - create the first one."
            : "No practice quizzes. Your timed exams are under Examinations."}
        </div>
      ) : (
        <div className="tile-grid">
          {practice.map((q) => {
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
                    {q.questionCount} question{q.questionCount === 1 ? "" : "s"}
                    {" · "}
                    {q.owner === "system" ? "HOSA sample" : mine ? "Yours" : `By ${q.owner}`}
                    {q.people.length > 0 ? ` · shared with ${q.people.length}` : ""}
                  </p>
                </div>
                <div className="tile-actions">
                  <Link className="btn primary" href={withBack(`/quizzes/${q.id}`, backHref)}>Take</Link>
                  {editable && <Link className="btn" href={withBack(`/quizzes/${q.id}/edit`, backHref)}>Edit</Link>}
                  {/* No Attempts link here any more. Practice quizzes record
                      nothing — only exams create attempts — so on this list it
                      was permanently dead. It moved to the exam cards in
                      ExaminationsView, where there is something to review, and
                      it keeps the chapter-staff reach it was given there. */}
                  {mayAssign && <button type="button" className="btn" onClick={() => setAssigning(q)}>Assign...</button>}
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
      {assigning && (
        <AssignToPeople
          resource={{ kind: "quiz", id: assigning.id, title: assigning.title }}
          onClose={() => setAssigning(null)}
          notify={setFlash}
        />
      )}
    </section>
  );
}
