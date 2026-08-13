"use client";

import * as React from "react";

import {
  ALL_KEY,
  type Feedback,
  type FeedbackGroup,
  type FeedbackKind,
  groupFeedback,
  TARGET_KIND_LABEL,
} from "@/lib/feedback-view";

const KIND_LABEL: Record<FeedbackKind, string> = { bug: "Bug", idea: "Idea", other: "Other" };

function ago(ms: number): string {
  const s = Math.max(1, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export function FeedbackView({ admin }: { admin: boolean }) {
  const [kind, setKind] = React.useState<FeedbackKind>("bug");
  const [message, setMessage] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [sent, setSent] = React.useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!message.trim()) return;
    setBusy(true);
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, message, page: typeof window !== "undefined" ? window.location.pathname + window.location.search : undefined }),
      }).catch(() => null);
      if (res?.ok) {
        setSent(true);
        setMessage("");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="role-section">
      <div className="section-head">
        <h2>Feedback</h2>
        <span className="section-count">Report a bug or share an idea</span>
      </div>

      <form className="feedback-form" onSubmit={submit}>
        <div className="feedback-kinds" role="radiogroup" aria-label="Type">
          {(["bug", "idea", "other"] as FeedbackKind[]).map((k) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={kind === k}
              className={`feedback-kind${kind === k ? " is-active" : ""}`}
              onClick={() => setKind(k)}
            >
              {KIND_LABEL[k]}
            </button>
          ))}
        </div>
        <textarea
          className="feedback-text"
          value={message}
          onChange={(e) => { setMessage(e.target.value); setSent(false); }}
          placeholder={kind === "bug" ? "What went wrong? What were you doing when it happened?" : "Tell us what you're thinking..."}
          maxLength={2000}
          rows={5}
        />
        <div className="feedback-actions">
          <button type="submit" className="cta" disabled={busy || !message.trim()}>{busy ? "Sending..." : "Send"}</button>
          {sent && <span className="feedback-thanks" role="status">Thanks - your report was sent.</span>}
        </div>
      </form>

      {admin && <AdminFeedbackList />}
    </section>
  );
}

/**
 * The admin half: every report, bucketed by the content it was filed against.
 *
 * The flat feed this replaced could tell you that eleven people were unhappy
 * but not that nine of them were unhappy about the same module, which is the
 * only version of that fact you can act on.
 *
 * Everything is fetched once and grouped on the client rather than through the
 * endpoint's targetKind/targetId filter: the counts on the tabs are a claim
 * about the whole set, so a per-tab fetch would have to load everything anyway
 * and would go stale against the tab you are looking at.
 */
function AdminFeedbackList() {
  const [items, setItems] = React.useState<Feedback[]>([]);
  const [tab, setTab] = React.useState<string>(ALL_KEY);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);

  const load = React.useCallback(async () => {
    const res = await fetch("/api/feedback", { cache: "no-store" }).catch(() => null);
    if (!res?.ok) {
      setError(res?.status === 403 ? "Admins only." : "Couldn't load reports.");
      setLoading(false);
      return;
    }
    const body = await res.json().catch(() => null);
    setItems(Array.isArray(body?.feedback) ? body.feedback : []);
    setError(null);
    setLoading(false);
  }, []);

  // Every setState follows an await, same as the other data views.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  React.useEffect(() => { void load(); }, [load]);

  async function toggle(id: string, resolved: boolean) {
    setBusy(id);
    const res = await fetch("/api/feedback", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, resolved }),
    }).catch(() => null);
    setBusy(null);
    if (!res?.ok) {
      setError("Couldn't update that report.");
      return;
    }
    await load();
  }

  const groups = React.useMemo(() => groupFeedback(items), [items]);
  const openCount = groups.reduce((n, g) => n + g.open, 0);
  // A tab can outlive its group once the store's ring buffer drops the last
  // report in it, so select by filter rather than trusting the key exists.
  const shown = tab === ALL_KEY ? groups : groups.filter((g) => g.key === tab);

  return (
    <div className="feedback-admin">
      <div className="section-head" style={{ marginTop: 24 }}>
        <h2>Reports</h2>
        {/* Counts wait for the data. "0 open" while a fetch is in flight is not
            a neutral placeholder, it is the answer an admin came here for. */}
        {!loading && <span className="section-count">{openCount} open · {items.length} total</span>}
      </div>

      {!loading && groups.length > 0 && (
        <>
          <p className="section-note">
            Grouped by what each report is about. Whatever has the most unanswered reports comes
            first; resolved ones stay on record underneath.
          </p>

          {/* One tab per piece of content complained about, so "show me everything
              filed against this quiz" is one click and not a read of the whole feed. */}
          <div className="audit-filter" role="tablist" aria-label="Filter reports" style={{ flexWrap: "wrap" }}>
            <button type="button" className={tab === ALL_KEY ? "on" : ""} aria-pressed={tab === ALL_KEY} onClick={() => setTab(ALL_KEY)}>
              All reports ({openCount})
            </button>
            {groups.map((g) => (
              <button key={g.key} type="button" className={tab === g.key ? "on" : ""} aria-pressed={tab === g.key} onClick={() => setTab(g.key)}>
                {g.title} ({g.open})
              </button>
            ))}
          </div>
        </>
      )}

      {error && <div className="empty-state">{error}</div>}

      {loading ? (
        <div className="empty-state">Loading reports...</div>
      ) : shown.length > 0 ? (
        shown.map((group) => (
          <GroupSection key={group.key} group={group} busy={busy} onToggle={toggle} />
        ))
      ) : error ? null : (
        // Only claim there is nothing when we actually know: after a failed
        // load an empty list means we couldn't ask, not that nobody reported.
        <div className="empty-state">{groups.length === 0 ? "No reports yet." : "Nothing filed against that."}</div>
      )}
    </div>
  );
}

function GroupSection({ group, busy, onToggle }: {
  group: FeedbackGroup;
  busy: string | null;
  onToggle: (id: string, resolved: boolean) => void;
}) {
  return (
    <>
      <div className="section-head" style={{ marginTop: 20, marginBottom: 10 }}>
        {/* The title is the one the reporter saw, replayed from the report. The
            content itself is never fetched, so a deleted module still has a
            heading instead of a dangling id. */}
        <h3>
          {group.kind ? <span className="badge badge-muted">{TARGET_KIND_LABEL[group.kind]}</span> : null}
          {group.kind ? " " : ""}
          {group.title}
        </h3>
        <span className="section-count">{group.open} open · {group.total} total</span>
      </div>
      <div className="feedback-list">
        {group.items.map((f) => (
          <ReportItem key={f.id} report={f} busy={busy === f.id} onToggle={onToggle} />
        ))}
      </div>
    </>
  );
}

function ReportItem({ report, busy, onToggle }: {
  report: Feedback;
  busy: boolean;
  onToggle: (id: string, resolved: boolean) => void;
}) {
  return (
    <div className={`feedback-item${report.resolved ? " is-resolved" : ""}`}>
      <div className="feedback-item-head">
        <span className={`feedback-badge kind-${report.kind}`}>{KIND_LABEL[report.kind]}</span>
        {/* Which question is most of what a quiz report is worth: without it an
            admin has to re-read the whole quiz to find what the member meant. */}
        {report.target?.question ? (
          <span className="badge badge-warn">Question {report.target.question}</span>
        ) : null}
        {report.resolved && <span className="badge badge-muted">Resolved</span>}
        <span className="feedback-meta">{report.reporter} · {ago(report.at)}{report.page ? ` · ${report.page}` : ""}</span>
      </div>
      <p className="feedback-message">{report.message}</p>
      <button type="button" className="link-btn" disabled={busy} onClick={() => onToggle(report.id, !report.resolved)}>
        {report.resolved ? "Reopen" : "Mark resolved"}
      </button>
    </div>
  );
}
