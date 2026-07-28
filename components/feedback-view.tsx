"use client";

import * as React from "react";

type Kind = "bug" | "idea" | "other";
type Feedback = {
  id: string;
  kind: Kind;
  message: string;
  page?: string;
  reporter: string;
  at: number;
  resolved: boolean;
};

const KIND_LABEL: Record<Kind, string> = { bug: "Bug", idea: "Idea", other: "Other" };

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
  const [kind, setKind] = React.useState<Kind>("bug");
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
          {(["bug", "idea", "other"] as Kind[]).map((k) => (
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

function AdminFeedbackList() {
  const [items, setItems] = React.useState<Feedback[] | null>(null);
  const [filter, setFilter] = React.useState<"open" | "all">("open");

  const load = React.useCallback(async () => {
    const res = await fetch("/api/feedback", { cache: "no-store" }).catch(() => null);
    const j = res?.ok ? await res.json().catch(() => null) : null;
    if (Array.isArray(j?.feedback)) setItems(j.feedback);
  }, []);

  React.useEffect(() => {
    let live = true;
    fetch("/api/feedback", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (live && Array.isArray(j?.feedback)) setItems(j.feedback); })
      .catch(() => {});
    return () => { live = false; };
  }, []);

  async function toggle(id: string, resolved: boolean) {
    const res = await fetch("/api/feedback", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, resolved }),
    }).catch(() => null);
    if (res?.ok) await load();
  }

  if (!items) return <div className="empty-state">Loading reports...</div>;
  const shown = filter === "open" ? items.filter((i) => !i.resolved) : items;
  const openCount = items.filter((i) => !i.resolved).length;

  return (
    <div className="feedback-admin">
      <div className="section-head" style={{ marginTop: 24 }}>
        <h2>Reports</h2>
        <span className="section-count">{openCount} open · {items.length} total</span>
      </div>
      <div className="audit-filter" role="tablist" aria-label="Filter reports">
        <button type="button" className={filter === "open" ? "on" : ""} aria-pressed={filter === "open"} onClick={() => setFilter("open")}>Open</button>
        <button type="button" className={filter === "all" ? "on" : ""} aria-pressed={filter === "all"} onClick={() => setFilter("all")}>All</button>
      </div>
      {shown.length === 0 ? (
        <div className="empty-state">{filter === "open" ? "No open reports. Nice." : "No reports yet."}</div>
      ) : (
        <div className="feedback-list">
          {shown.map((f) => (
            <div key={f.id} className={`feedback-item${f.resolved ? " is-resolved" : ""}`}>
              <div className="feedback-item-head">
                <span className={`feedback-badge kind-${f.kind}`}>{KIND_LABEL[f.kind]}</span>
                <span className="feedback-meta">{f.reporter} · {ago(f.at)}{f.page ? ` · ${f.page}` : ""}</span>
              </div>
              <p className="feedback-message">{f.message}</p>
              <button type="button" className="link-btn" onClick={() => toggle(f.id, !f.resolved)}>
                {f.resolved ? "Reopen" : "Mark resolved"}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
