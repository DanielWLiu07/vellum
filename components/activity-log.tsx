"use client";

import * as React from "react";

import { isModerationBlock, type AuditEvent } from "@/lib/audit-shared";

const ACTION_LABEL: Record<string, string> = {
  "document.upload": "Uploaded document",
  "document.delete": "Deleted document",
  "document.share": "Shared document",
  "document.blocked": "Blocked upload",
  "deck.create": "Created deck",
  "deck.update": "Edited deck",
  "deck.delete": "Deleted deck",
  "deck.blocked": "Blocked deck",
  "quiz.create": "Created quiz",
  "quiz.update": "Edited quiz",
  "quiz.delete": "Deleted quiz",
  "quiz.blocked": "Blocked quiz",
  "image.blocked": "Blocked image",
  "profile.update": "Updated profile",
  "profile.blocked": "Blocked profile edit",
  "document.copyright_blocked": "Blocked (copyright)",
  "folder.create": "Created folder",
  "folder.update": "Renamed folder",
  "folder.delete": "Deleted folder",
  "folder.blocked": "Blocked folder name",
  "auth.signin": "Signed in",
  "auth.signout": "Signed out",
  "feedback.submit": "Feedback submitted",
  "comment.post": "Comment posted",
  "comment.delete": "Comment deleted",
  "comment.blocked": "Blocked comment",
};

interface ModerationStatus {
  configured: boolean;
  /** Key present but the last call didn't get through — on, and not working. */
  degraded?: boolean;
  lastStatus?: number;
  /** Items queued because nobody could examine them, not because of a verdict. */
  heldUnchecked?: number;
  blockedCount: number;
}

function ago(ms: number): string {
  const s = Math.max(1, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

interface StorageStatus {
  backend: "s3" | "r2" | "memory";
  durable: boolean;
}

export function ActivityLog() {
  const [events, setEvents] = React.useState<AuditEvent[]>([]);
  const [moderation, setModeration] = React.useState<ModerationStatus | null>(null);
  const [storage, setStorage] = React.useState<StorageStatus | null>(null);
  const [filter, setFilter] = React.useState<"all" | "blocked">("all");
  const [loading, setLoading] = React.useState(true);
  /**
   * The most consequential silent failure of the group, and the reason this
   * one gets a flag of its own rather than falling through to an empty list.
   *
   * Everywhere else a dropped fetch costs a member a list they can reload. Here
   * it costs an ADMIN the exact thing they opened the page to check. "No
   * activity yet." and "No content has been blocked." are not neutral blanks:
   * they are specific, reassuring claims that nothing has been uploaded,
   * blocked, or deleted. A failed /api/audit produced that reassurance while
   * the log went entirely unread — worse than showing nothing, because a clean
   * audit trail is what an admin is hoping to see and the thing most likely to
   * stop them looking further.
   */
  const [error, setError] = React.useState(false);

  const load = React.useCallback(async () => {
    const res = await fetch("/api/audit", { cache: "no-store" }).catch(() => null);
    const data = res?.ok ? await res.json().catch(() => null) : null;
    if (!data) {
      setError(true);
      setLoading(false);
      return;
    }
    setEvents(data.events ?? []);
    setModeration(data.moderation ?? null);
    setStorage(data.storage ?? null);
    setError(false);
    setLoading(false);
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  React.useEffect(() => { void load(); }, [load]);

  const shown = filter === "blocked" ? events.filter((e) => isModerationBlock(e.action)) : events;

  return (
    <section className="role-section">
      <div className="section-head">
        <h2>Audit trail</h2>
        {/* A count of what we failed to fetch is still a count, and "0 recent
            actions" is the same false all-clear as the empty state below. */}
        <span className="section-count">{error ? "unavailable" : `${events.length} recent actions`}</span>
      </div>

      {/* Moderation report: is AI moderation on, and how much has it blocked. */}
      {moderation ? (
        <div className="mod-status" data-testid="mod-status">
          {/* Three states, not two. "On" used to mean only that a key was set,
              so a completely unreachable endpoint still read as healthy. */}
          <span
            className={`mod-status-dot${moderation.configured && !moderation.degraded ? " on" : ""}`}
            aria-hidden
          />
          <span className="mod-status-text">
            AI moderation:{" "}
            <strong>
              {!moderation.configured ? "Off" : moderation.degraded ? "Not responding" : "On"}
            </strong>
            {moderation.degraded ? (
              <>
                {" "}
                — calls are failing
                {moderation.lastStatus ? ` (HTTP ${moderation.lastStatus})` : ""}, so uploads are
                being held for review instead of checked.
              </>
            ) : null}
          </span>
          <span className="mod-status-count">
            {moderation.blockedCount} item{moderation.blockedCount === 1 ? "" : "s"} blocked
            {moderation.heldUnchecked
              ? ` · ${moderation.heldUnchecked} held unchecked`
              : ""}
          </span>
        </div>
      ) : null}

      {/* Blob storage has no snapshot to fail loudly, so without this an
          instance quietly losing every upload looks identical to a healthy
          one — right up until a member reports a missing file. */}
      {storage && !storage.durable ? (
        <div className="mod-status" data-testid="storage-status">
          <span className="mod-status-dot" aria-hidden />
          <span className="mod-status-text">
            Uploads: <strong>not durable</strong> — held in memory only. They are lost on the next
            restart and are invisible to other instances now. Configure R2 or S3 object storage.
          </span>
        </div>
      ) : null}

      <div className="audit-filter" role="tablist" aria-label="Filter activity">
        <button
          type="button"
          className={filter === "all" ? "on" : ""}
          aria-pressed={filter === "all"}
          onClick={() => setFilter("all")}
        >
          All activity
        </button>
        <button
          type="button"
          className={filter === "blocked" ? "on" : ""}
          aria-pressed={filter === "blocked"}
          onClick={() => setFilter("blocked")}
        >
          Moderation blocks
        </button>
      </div>

      {loading ? (
        <div className="empty-state">Loading...</div>
      ) : error ? (
        <div className="empty-state">
          Couldn&apos;t load the audit trail. This is not an empty log — nothing here has been
          read, so treat it as unknown rather than clear.{" "}
          <button type="button" className="btn" onClick={() => { setLoading(true); void load(); }}>Retry</button>
        </div>
      ) : shown.length === 0 ? (
        <div className="empty-state">
          {filter === "blocked" ? "No content has been blocked." : "No activity yet."}
        </div>
      ) : (
        <div className="table-card">
          {shown.map((e) => {
            const blocked = isModerationBlock(e.action);
            return (
              <div key={e.id} className="member-row">
                <div className="member-id">
                  <div>
                    <p className="member-name">
                      {blocked ? <span className="audit-chip">Blocked</span> : null}
                      {ACTION_LABEL[e.action] ?? e.action}: {e.target}
                    </p>
                    <p className="member-email">
                      {e.actor}
                      {blocked && e.detail ? ` · flagged: ${e.detail}` : ""}
                    </p>
                  </div>
                </div>
                <span className="member-frac">{ago(e.at)}</span>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
