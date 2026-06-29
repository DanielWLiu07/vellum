"use client";

import * as React from "react";

import type { AuditEvent } from "@/lib/audit";

const ACTION_LABEL: Record<string, string> = {
  "document.upload": "Uploaded document",
  "document.delete": "Deleted document",
  "document.share": "Shared document",
  "deck.create": "Created deck",
  "deck.delete": "Deleted deck",
  "quiz.create": "Created quiz",
  "quiz.delete": "Deleted quiz",
};

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
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch("/api/audit", { cache: "no-store" }).catch(() => null);
      if (cancelled) return;
      if (res?.ok) setEvents((await res.json()).events);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="role-section">
      <div className="section-head"><h2>Activity log</h2><span className="section-count">{events.length} recent actions</span></div>
      {loading ? (
        <div className="empty-state">Loading...</div>
      ) : events.length === 0 ? (
        <div className="empty-state">No activity yet.</div>
      ) : (
        <div className="table-card">
          {events.map((e) => (
            <div key={e.id} className="member-row">
              <div className="member-id">
                <div>
                  <p className="member-name">{ACTION_LABEL[e.action] ?? e.action}: {e.target}</p>
                  <p className="member-email">{e.actor}</p>
                </div>
              </div>
              <span className="member-frac">{ago(e.at)}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
