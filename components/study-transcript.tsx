"use client";

/**
 * Everything a member has studied, in one list.
 *
 * The question this answers is "what have I actually done for Medical
 * Terminology" - which nothing in Vitals could answer, because the only record
 * of learning was the completion box on work a trainer had handed out. Study a
 * module on your own initiative and the platform forgot it happened.
 *
 * Read-only by design. This is a record, not a checklist: nothing here can be
 * ticked, edited or cleared, because the moment a transcript becomes a claim
 * the member can adjust, it stops being evidence of anything.
 */

import * as React from "react";

// Type-only: lib/study-activity owns the store and reaches node:fs, so a VALUE
// imported from it would follow the module into the client bundle. Types don't.
import type { StudyKind, TranscriptEntry } from "@/lib/study-activity";

const KIND_LABEL: Record<StudyKind, string> = {
  module: "Module",
  deck: "Flashcards",
  quiz: "Quiz",
  doc: "Document",
};

function when(ms: number): string {
  const s = Math.max(1, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

/**
 * What the member did with one thing, in words rather than four counters.
 *
 * Only the parts that happened are mentioned. A deck reports reviews, a module
 * reports subsections; showing "0 reviews" against a module would invite the
 * reading that reviews were expected and skipped.
 */
function activityLine(e: TranscriptEntry): string {
  const bits: string[] = [];
  if (e.partsCompleted > 0) bits.push(`${e.partsCompleted} section${e.partsCompleted === 1 ? "" : "s"} completed`);
  if (e.partsViewed > 0) bits.push(`${e.partsViewed} opened`);
  if (e.reviews > 0) bits.push(`${e.reviews} card review${e.reviews === 1 ? "" : "s"}`);
  if (bits.length === 0) bits.push(e.completed ? "Completed" : "Opened");
  return bits.join(" · ");
}

export function StudyTranscript() {
  const [entries, setEntries] = React.useState<TranscriptEntry[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let live = true;
    fetch("/api/study", { cache: "no-store" })
      .then(async (res) => {
        if (!live) return;
        if (!res.ok) {
          setError("Couldn't load your study record.");
          return;
        }
        const j = await res.json().catch(() => null);
        if (live) setEntries(Array.isArray(j?.entries) ? j.entries : []);
      })
      .catch(() => {
        if (live) setError("Couldn't load your study record.");
      });
    return () => {
      live = false;
    };
  }, []);

  return (
    <section className="role-section">
      <div className="section-head">
        <h2>What you&apos;ve studied</h2>
        {entries && entries.length > 0 && (
          <span className="section-count">
            {entries.length} item{entries.length === 1 ? "" : "s"}
          </span>
        )}
      </div>

      {error ? (
        <div className="empty-state">{error}</div>
      ) : !entries ? (
        <div className="empty-state">Loading...</div>
      ) : entries.length === 0 ? (
        // Names what counts, so a member who has been reading documents doesn't
        // read an empty page as their work having been thrown away.
        <div className="empty-state">
          Nothing yet. Open a module or study a deck and it will show up here — including
          work nobody assigned you.
        </div>
      ) : (
        <div className="table-card">
          {entries.map((e) => (
            <div key={`${e.kind}:${e.refId}`} className="member-row">
              <div className="member-id">
                <div>
                  <p className="member-name">
                    <span className="badge badge-muted">{KIND_LABEL[e.kind]}</span> {e.title}
                    {/* The content is gone but the studying isn't. Saying so
                        beats a title that quietly stops matching anything. */}
                    {e.removed && <span className="badge badge-muted"> No longer available</span>}
                  </p>
                  <p className="member-email">{activityLine(e)}</p>
                </div>
              </div>
              <span className="member-frac">{when(e.lastStudiedAt)}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
