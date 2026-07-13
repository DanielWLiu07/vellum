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

export function ActivityLog() {
  const [events, setEvents] = React.useState<AuditEvent[]>([]);
  const [moderation, setModeration] = React.useState<ModerationStatus | null>(null);
  const [filter, setFilter] = React.useState<"all" | "blocked">("all");
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch("/api/audit", { cache: "no-store" }).catch(() => null);
      if (cancelled) return;
      if (res?.ok) {
        const data = await res.json();
        setEvents(data.events ?? []);
        setModeration(data.moderation ?? null);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const shown = filter === "blocked" ? events.filter((e) => isModerationBlock(e.action)) : events;

  return (
    <section className="role-section">
      <div className="section-head">
        <h2>Audit trail</h2>
        <span className="section-count">{events.length} recent actions</span>
      </div>

      {/* Moderation report: is AI moderation on, and how much has it blocked. */}
      {moderation ? (
        <div className="mod-status" data-testid="mod-status">
          <span className={`mod-status-dot${moderation.configured ? " on" : ""}`} aria-hidden />
          <span className="mod-status-text">
            AI moderation: <strong>{moderation.configured ? "On" : "Off"}</strong>
          </span>
          <span className="mod-status-count">
            {moderation.blockedCount} item{moderation.blockedCount === 1 ? "" : "s"} blocked
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
