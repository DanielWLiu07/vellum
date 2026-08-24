"use client";

/**
 * Examinations — the timed, proctored half of the quiz engine, given its own room.
 *
 * An exam is not a separate entity: it is a quiz carrying ExamSettings (see
 * lib/quizzes), and it is graded, recorded and reviewed by the machinery that
 * was already here — /api/quizzes/[id]/grade, /api/quizzes/[id]/attempts,
 * /api/my-attempts, components/quiz-take, components/quiz-attempts. Nothing in
 * this file re-implements any of that, and deliberately so: the architecture
 * spec (§1) is explicit that exam mode in Vitals stays ADVISORY and the real
 * proctored engine belongs to the member platform. This is a surface, not an
 * engine.
 *
 * What it fixes is that exams had nowhere of their own. They sat in the Quizzes
 * grid behind a small "Exam" badge, so a countdown that auto-submits, refuses
 * to show you the answer key afterwards, and can void your attempt outright was
 * one indistinguishable tile away from a practice self-test that does none of
 * those things. A member could start one without knowing which they had picked.
 *
 * Two reads are joined here, and neither is new:
 *   - /api/quizzes  → every exam this member may see (already visibility-scoped)
 *   - /api/my-attempts → their OWN sittings, grouped by quiz
 * so each card can answer "what is this, and where do I stand on it" before the
 * member commits to sitting it. The attempt history is the taker's own — no
 * gate is widened to build this view.
 */

import Link from "next/link";
import * as React from "react";

import type { QuizMeta } from "@/lib/quizzes";
import type { MyQuizHistory } from "@/lib/quiz-history";
import { withBack } from "@/lib/return-to";
import { canEdit, canManageSharing } from "@/lib/visibility";

import { AssignToPeople } from "./assign-to-people";
import { canAssign, useMe } from "./use-assignments";
import { useViewer } from "./use-viewer";

import { FavoriteButton } from "./favorite-button";
import { ShareDialog, type ShareTarget } from "./share-dialog";
import { useDashboardReturn } from "./use-return-to";

const VIS_LABEL = { public: "Public", chapter: "Chapter", private: "Private" } as const;

type ExamFilter = "all" | "open" | "todo" | "done";
const FILTERS: { id: ExamFilter; label: string }[] = [
  { id: "all", label: "All exams" },
  { id: "open", label: "Open now" },
  { id: "todo", label: "Not yet sat" },
  { id: "done", label: "Completed" },
];

/** "Mon 3 Mar, 09:00" — a scheduled instant, in the reader's own timezone. */
function fmtWhen(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  });
}

/** "45 min" / "1h 30m" / "90s" — the commitment, in the unit a person thinks in. */
function fmtLimit(sec: number): string {
  if (sec < 60) return `${sec}s`;
  const m = Math.round(sec / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem ? `${h}h ${rem}m` : `${h}h`;
}

/**
 * How this member stands on one exam, derived from their own attempt history.
 *
 * `best` is null when every sitting was voided — which is NOT the same as never
 * having sat it, and the card has to say so. A voided attempt is excluded from
 * best/latest by lib/quiz-attempts on purpose (an attempt that doesn't count
 * must not quietly set a personal best), so "0 counted, 2 voided" is a real and
 * confusing state unless it is named.
 */
interface ExamStanding {
  sat: boolean;
  attempts: number;
  counted: number;
  voided: number;
  best: number | null;
  latest: number | null;
}

function standingOf(history: MyQuizHistory[] | null, quizId: string): ExamStanding {
  const h = history?.find((x) => x.quizId === quizId);
  if (!h) return { sat: false, attempts: 0, counted: 0, voided: 0, best: null, latest: null };
  return {
    sat: h.attempts.length > 0,
    attempts: h.attempts.length,
    counted: h.counted,
    voided: h.voided,
    best: h.bestPercent,
    latest: h.latestPercent,
  };
}

export function ExaminationsView() {
  const viewer = useViewer();
  const me = useMe();
  // Presentation only. /api/quizzes/[id]/attempts re-decides against the signed
  // session and FILTERS ITS ROWS to the caller's chapter, so showing this link
  // can never widen what following it returns (§9.3, §12.3).
  const isStaff = canAssign(me?.role);
  // Same gate the assign route enforces, mirrored for presentation only (see
  // components/use-assignments). A student is not shown a button the API would
  // then refuse; a trainer who IS shown one still has the route re-decide.
  const mayAssign = isStaff;
  const backHref = useDashboardReturn("examinations");

  const [quizzes, setQuizzes] = React.useState<QuizMeta[] | null>(null);
  const [history, setHistory] = React.useState<MyQuizHistory[] | null>(null);
  const [loadError, setLoadError] = React.useState(false);
  const [filter, setFilter] = React.useState<ExamFilter>("all");
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [share, setShare] = React.useState<ShareTarget | null>(null);
  const [assigning, setAssigning] = React.useState<QuizMeta | null>(null);
  const [flash, setFlashMsg] = React.useState<string | null>(null);
  const flashTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // Transient status line that clears itself — banners that never dismiss pile
  // up across interactions (the same finding Quizzes and Flashcards carry).
  const setFlash = React.useCallback((msg: string) => {
    setFlashMsg(msg);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlashMsg(null), 4000);
  }, []);
  React.useEffect(() => () => { if (flashTimer.current) clearTimeout(flashTimer.current); }, []);

  // A failed load must not fall through to an empty array: "No exams yet" is a
  // claim about the library, and reporting an outage as that claim is the bug
  // Quizzes and Flashcards already fixed. quizzes stays null until it is known.
  const load = React.useCallback(async () => {
    const res = await fetch("/api/quizzes", { cache: "no-store" }).catch(() => null);
    if (res?.ok) {
      const j = await res.json().catch(() => null);
      setQuizzes(Array.isArray(j?.quizzes) ? j.quizzes : []);
      setLoadError(false);
    } else {
      setLoadError(true);
    }
  }, []);

  // The member's own results. A failure here is NOT fatal to the page: the
  // exams still list and can still be sat, you just don't get "Best 80%" on the
  // card. Silently leaving history null degrades to "Not yet sat", which would
  // be a lie, so a failed history load renders as no standing at all.
  const loadHistory = React.useCallback(async () => {
    const res = await fetch("/api/my-attempts", { cache: "no-store" }).catch(() => null);
    if (!res?.ok) return;
    const j = await res.json().catch(() => null);
    setHistory(Array.isArray(j?.quizzes) ? j.quizzes : []);
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  React.useEffect(() => { void load(); void loadHistory(); }, [load, loadHistory]);

  async function copy(q: QuizMeta) {
    if (busyId) return;
    setBusyId(q.id);
    const res = await fetch(`/api/quizzes/${q.id}/copy`, { method: "POST" }).catch(() => null);
    if (res?.ok) {
      const j = await res.json().catch(() => null);
      setFlash(`Created "${j?.title ?? q.title}" (private) - it's yours to edit.`);
      await load();
    } else {
      setFlash("Couldn't copy the exam.");
    }
    setBusyId(null);
  }

  // Not optimistic: the tile used to vanish on click and quietly return if the
  // server refused, which reads as the list glitching rather than a refusal.
  async function del(id: string) {
    if (busyId) return;
    if (typeof window !== "undefined" && !window.confirm("Delete this exam? Attempts already recorded are kept.")) return;
    setBusyId(id);
    const res = await fetch(`/api/quizzes/${id}`, { method: "DELETE" }).catch(() => null);
    setBusyId(null);
    if (!res?.ok) {
      setFlash("Couldn't delete that exam. It's still here.");
      return;
    }
    setQuizzes((qs) => (qs ?? []).filter((x) => x.id !== id));
  }

  // An exam is a quiz with ExamSettings. /api/quizzes has already filtered to
  // what this viewer may see, so this narrows by KIND only, never by access.
  const exams = (quizzes ?? []).filter((q) => q.isExam);
  const counts: Record<ExamFilter, number> = {
    all: exams.length,
    // An exam with no window is always sittable, so it counts as open.
    open: exams.filter((q) => (q.examWindow ?? "open") === "open").length,
    todo: exams.filter((q) => !standingOf(history, q.id).sat).length,
    done: exams.filter((q) => standingOf(history, q.id).sat).length,
  };
  const visible = exams.filter((q) => {
    if (filter === "all") return true;
    if (filter === "open") return (q.examWindow ?? "open") === "open";
    return standingOf(history, q.id).sat === (filter === "done");
  });

  return (
    <section className="role-section">
      <div className="section-head">
        <h2>Examinations</h2>
        {/* exam=1 lands on the quiz form with exam mode ALREADY ON. Without it this
            button hands you a practice quiz and calls it an exam. */}
        <Link className="cta" href={withBack("/upload?type=quiz&exam=1", backHref)}>+ Create exam</Link>
      </div>
      <p className="dash-sub" style={{ marginTop: -4, marginBottom: 12 }}>
        Timed sittings. The clock auto-submits at zero, the answer key stays hidden before and
        after, and leaving the exam surface is recorded for whoever set it — enough flags void
        the attempt. Practice self-tests live under Quizzes. Graded FLC exams live in the main
        HOSA platform.
      </p>
      {flash && <p className="dash-sub" role="status" style={{ marginBottom: 12 }}>{flash}</p>}

      {exams.length > 0 && (
        <div className="seg-toggle" role="tablist" aria-label="Exam status">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              role="tab"
              aria-selected={filter === f.id}
              className={`seg-btn${filter === f.id ? " is-active" : ""}`}
              onClick={() => setFilter(f.id)}
            >
              {f.label} <span className="seg-count">{counts[f.id]}</span>
            </button>
          ))}
        </div>
      )}

      <div className="tile-grid" style={{ marginTop: 14 }}>
        {loadError ? (
          <div className="empty-state">
            Couldn&apos;t load your exams. <button type="button" className="btn" onClick={() => void load()}>Retry</button>
          </div>
        ) : !quizzes ? (
          <div className="empty-state">Loading...</div>
        ) : exams.length === 0 ? (
          // Names the distinction rather than just reporting zero: someone who
          // has written plenty of quizzes needs to know an exam is a quiz with
          // a time limit set, or this page reads as broken.
          <div className="empty-state">
            No exams yet. An exam is a quiz with a time limit set — create one, or open an
            existing quiz&apos;s editor and give it a time limit.
          </div>
        ) : visible.length === 0 ? (
          <div className="empty-state">
            {filter === "open"
              ? "Nothing is open right now. Scheduled exams appear here inside their window."
              : filter === "todo"
                ? "You've sat every exam available to you."
                : "You haven't sat any of these yet."}
          </div>
        ) : (
          visible.map((q) => (
            <ExamCard
              key={q.id}
              exam={q}
              standing={standingOf(history, q.id)}
              viewer={viewer}
              isStaff={isStaff}
              backHref={backHref}
              busy={busyId === q.id}
              mayAssign={mayAssign}
              onAssign={() => setAssigning(q)}
              onCopy={() => void copy(q)}
              onDelete={() => void del(q.id)}
              onShare={() => setShare({ kind: "quiz", id: q.id, name: q.title, visibility: q.visibility, chapter: q.chapter, people: q.people, owner: q.owner })}
            />
          ))
        )}
      </div>

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

function ExamCard({ exam, standing, viewer, isStaff, backHref, busy, mayAssign, onAssign, onCopy, onDelete, onShare }: {
  exam: QuizMeta;
  standing: ExamStanding;
  viewer: ReturnType<typeof useViewer>;
  isStaff: boolean;
  backHref: string;
  busy: boolean;
  mayAssign: boolean;
  onAssign: () => void;
  onCopy: () => void;
  onDelete: () => void;
  onShare: () => void;
}) {
  const editable = exam.id !== "sample-quiz" && canEdit(exam, viewer);
  const canShare = exam.id !== "sample-quiz" && canManageSharing(exam, viewer);
  const mine = exam.owner === viewer.owner;
  // Every sitting voided is not the same as never having sat it, and it is the
  // state a member is most likely to misread as their score being lost.
  const allVoided = standing.sat && standing.counted === 0;
  // null = unscheduled, so no schedule line and nothing to gate on.
  const window = exam.examWindow ?? null;
  const sittable = window === null || window === "open";

  return (
    <div className="tile" data-testid={`exam-${exam.id}`}>
      <div className="tile-thumb">
        <div className="tile-preview" aria-hidden>
          <span className="tile-preview-title">{exam.title}</span>
          <span className="tile-line" />
          <span className="tile-line short" />
        </div>
        <span className={`tile-badge badge-${exam.visibility === "public" ? "ok" : exam.visibility === "chapter" ? "warn" : "muted"}`}>
          {VIS_LABEL[exam.visibility]}
        </span>
        <FavoriteButton id={exam.id} label={exam.title} />
      </div>

      <div className="tile-info">
        <p className="tile-title">{exam.title}</p>
        <p className="tile-sub">
          <span className="exam-badge" style={{ marginRight: 6 }}>Exam</span>
          {exam.questionCount} question{exam.questionCount === 1 ? "" : "s"}
          {typeof exam.examTimeLimitSec === "number" ? ` · ${fmtLimit(exam.examTimeLimitSec)}` : ""}
          {" · "}
          {exam.owner === "system" ? "HOSA sample" : mine ? "Yours" : `By ${exam.owner}`}
        </p>
        {/* The schedule, when there is one. Rendered from the server's verdict
            (examWindow) rather than by comparing timestamps here: a browser
            clock that disagrees would offer a Start the grade route refuses. */}
        {window !== null && (
          <p className={`exam-schedule is-${window}`}>
            {window === "upcoming"
              ? `Opens ${exam.examOpensAt ? fmtWhen(exam.examOpensAt) : "later"}`
              : window === "closed"
                ? `Closed ${exam.examClosesAt ? fmtWhen(exam.examClosesAt) : ""}`.trim()
                : exam.examClosesAt
                  ? `Open now · closes ${fmtWhen(exam.examClosesAt)}`
                  : "Open now"}
          </p>
        )}
        {/* Where this member stands, before they commit to sitting it. */}
        <p className="exam-standing">
          {!standing.sat ? (
            <span className="exam-standing-todo">Not yet sat</span>
          ) : allVoided ? (
            <span className="exam-standing-void">
              {standing.voided} attempt{standing.voided === 1 ? "" : "s"}, all voided — nothing counts yet
            </span>
          ) : (
            <>
              <span className="exam-standing-score">Best {standing.best}%</span>
              {standing.latest !== standing.best && <span> · latest {standing.latest}%</span>}
              <span> · {standing.attempts} attempt{standing.attempts === 1 ? "" : "s"}</span>
              {standing.voided > 0 && <span> · {standing.voided} voided</span>}
            </>
          )}
        </p>
      </div>

      <div className="tile-actions">
        {sittable ? (
          <Link className="btn primary" href={withBack(`/quizzes/${exam.id}`, backHref)}>
            {standing.sat ? "Sit again" : "Start exam"}
          </Link>
        ) : (
          // Not a link. Following one outside the window lands on a 403 the
          // runner has to explain; refusing here says the same thing without
          // the round trip. Editors keep the live link below.
          <button type="button" className="btn primary" disabled aria-disabled="true">
            {window === "upcoming" ? "Not open yet" : "Closed"}
          </button>
        )}
        {/* Whoever may edit it may also open it early — the server exempts them
            on both boundaries, so the link has to exist for them to use it. */}
        {!sittable && editable && (
          <Link className="btn" href={withBack(`/quizzes/${exam.id}`, backHref)}>Open early (yours)</Link>
        )}
        {editable && <Link className="btn" href={withBack(`/quizzes/${exam.id}/edit`, backHref)}>Edit</Link>}
        {/* Attempts was owner-only once, which left a trainer no way in on the
            HOSA-authored exams their own students actually sit. Chapter staff
            get the link; the route then filters to their chapter's takers, so
            following it on someone else's exam shows their members and nobody
            else's. */}
        {(mine || isStaff) && (
          <Link className="btn" href={withBack(`/quizzes/${exam.id}/attempts`, backHref)}>Attempts</Link>
        )}
        {/* Hand this exam to many members at once. Resource-first: the exam is
            already chosen, so the dialog only has to ask WHO. */}
        {mayAssign && <button type="button" className="btn" onClick={onAssign}>Assign...</button>}
        <button type="button" className="btn" disabled={busy} onClick={onCopy}>Make a copy</button>
        {canShare && <button type="button" className="btn" onClick={onShare}>Share</button>}
        {mine && <button type="button" className="btn danger" disabled={busy} onClick={onDelete}>Delete</button>}
      </div>
    </div>
  );
}
