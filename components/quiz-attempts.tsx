"use client";

import Link from "next/link";
import * as React from "react";

import { RETURN_TO, returnLabel } from "@/lib/return-to";

type IntegrityKind = "hidden" | "blur" | "fullscreen-exit" | "copy" | "paste" | "contextmenu";
type IntegrityFlag = { kind: IntegrityKind; at: number };
type Attempt = {
  id: string;
  quizId: string;
  taker: string;
  score: number;
  total: number;
  startedAt: number;
  submittedAt: number;
  durationSec: number;
  timeLimitSec: number;
  autoSubmitted: boolean;
  flags: IntegrityFlag[];
  voided: boolean;
  voidReason?: string;
};

const FLAG_LABEL: Record<IntegrityKind, string> = {
  hidden: "Tab hidden",
  blur: "Lost focus",
  "fullscreen-exit": "Left fullscreen",
  copy: "Copy",
  paste: "Paste",
  contextmenu: "Right-click",
};
const SERIOUS: ReadonlySet<IntegrityKind> = new Set(["hidden", "blur", "fullscreen-exit"]);

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

export function QuizAttempts({ quizId, backHref = RETURN_TO.quizzes }: {
  quizId: string;
  /** Validated destination for the way out (see lib/return-to). */
  backHref?: string;
}) {
  const backLabel = returnLabel(backHref);
  const [attempts, setAttempts] = React.useState<Attempt[] | null>(null);
  const [denied, setDenied] = React.useState(false);
  const [busyId, setBusyId] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    const res = await fetch(`/api/quizzes/${quizId}/attempts`, { cache: "no-store" }).catch(() => null);
    if (!res) return;
    if (res.status === 404 || res.status === 403) {
      setDenied(true);
      return;
    }
    const j = await res.json().catch(() => null);
    if (Array.isArray(j?.attempts)) setAttempts(j.attempts);
  }, [quizId]);

  React.useEffect(() => {
    let live = true;
    fetch(`/api/quizzes/${quizId}/attempts`, { cache: "no-store" })
      .then(async (res) => {
        if (!live) return;
        if (res.status === 404 || res.status === 403) {
          setDenied(true);
          return;
        }
        const j = await res.json().catch(() => null);
        if (live && Array.isArray(j?.attempts)) setAttempts(j.attempts);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [quizId]);

  async function setVoid(attemptId: string, makeVoid: boolean) {
    setBusyId(attemptId);
    try {
      const res = await fetch(`/api/quizzes/${quizId}/attempts`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(makeVoid ? { attemptId, void: true, reason: "Voided by reviewer" } : { attemptId, void: false }),
      }).catch(() => null);
      if (res?.ok) await load();
    } finally {
      setBusyId(null);
    }
  }

  if (denied) {
    return (
      <div className="upload-card">
        <h1 className="upload-h">Attempts unavailable</h1>
        <p className="dash-sub">This quiz doesn&apos;t exist, or you&apos;re not its owner. Only the owner or an admin can review exam attempts.</p>
        <Link className="btn" href={backHref}>← {backLabel}</Link>
      </div>
    );
  }
  if (!attempts) return <div className="upload-card"><p className="dash-sub">Loading attempts...</p></div>;

  return (
    <div className="upload-card">
      <div className="study-head">
        <h1 className="upload-h">Exam attempts</h1>
        <span className="section-count">{attempts.length} attempt{attempts.length === 1 ? "" : "s"}</span>
      </div>
      <p className="dash-sub">
        Integrity flags are advisory (client-reported). Attempts with several serious flags are auto-voided for your
        review; you can void or reinstate any attempt.
      </p>

      {attempts.length === 0 ? (
        <div className="empty-state">No one has taken this exam yet.</div>
      ) : (
        <div className="attempt-list">
          {attempts.map((a) => {
            const serious = a.flags.filter((f) => SERIOUS.has(f.kind)).length;
            return (
              <div key={a.id} className={`attempt-row${a.voided ? " is-voided" : ""}`}>
                <div className="attempt-head">
                  <span className="attempt-who">{a.taker}</span>
                  <span className="attempt-score">{a.score} / {a.total}</span>
                </div>
                <div className="attempt-meta">
                  <span>Submitted {when(a.submittedAt)}</span>
                  <span>Took {dur(a.durationSec)}</span>
                  {a.autoSubmitted && <span>Auto-submitted (time up)</span>}
                  <span>{serious} serious flag{serious === 1 ? "" : "s"}</span>
                </div>
                {a.flags.length > 0 && (
                  <div className="attempt-timeline" aria-label="Integrity timeline">
                    {a.flags.map((f, i) => (
                      <span key={i} className={`flag-chip${SERIOUS.has(f.kind) ? " is-serious" : ""}`}>
                        {FLAG_LABEL[f.kind]} · {dur(Math.round(f.at / 1000))}
                      </span>
                    ))}
                  </div>
                )}
                {a.voided && a.voidReason && <p className="attempt-void-note">Voided: {a.voidReason}</p>}
                <div className="attempt-actions">
                  {a.voided ? (
                    <button type="button" className="link-btn" disabled={busyId === a.id} onClick={() => setVoid(a.id, false)}>
                      Reinstate attempt
                    </button>
                  ) : (
                    <button type="button" className="link-btn link-danger" disabled={busyId === a.id} onClick={() => setVoid(a.id, true)}>
                      Void attempt
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
      <Link className="dash-back" href={backHref}>← {backLabel}</Link>
    </div>
  );
}
