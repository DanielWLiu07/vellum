"use client";

import * as React from "react";

import { useNames } from "./use-names";

/** `author` is an identity id, not a name — resolve it before showing it. */
type Comment = { id: string; author: string; body: string; at: number };

function ago(ms: number): string {
  const s = Math.max(1, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

/** A flat comment thread for a resource ("doc") or a module. Anyone who can see
 * the target can read and post; you can delete your own (admins delete any). */
export function Comments({ type, target }: { type: "doc" | "module"; target: string }) {
  const [comments, setComments] = React.useState<Comment[] | null>(null);
  const [text, setText] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  // Who am I (for the delete affordance). Default demo owner is "you".
  const [viewer, setViewer] = React.useState("you");
  const [admin, setAdmin] = React.useState(false);
  const { name } = useNames();

  React.useEffect(() => {
    let live = true;
    fetch("/api/auth/me", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!live || !j?.signedIn) return;
        if (typeof j.id === "string") setViewer(j.id);
        if (j.role === "admin" || j.role === "super_admin") setAdmin(true);
      })
      .catch(() => {});
    return () => { live = false; };
  }, []);

  const load = React.useCallback(async () => {
    const res = await fetch(`/api/comments?type=${type}&target=${encodeURIComponent(target)}`, { cache: "no-store" }).catch(() => null);
    const j = res?.ok ? await res.json().catch(() => null) : null;
    if (Array.isArray(j?.comments)) setComments(j.comments);
    else setComments([]);
  }, [type, target]);

  React.useEffect(() => {
    let live = true;
    fetch(`/api/comments?type=${type}&target=${encodeURIComponent(target)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (live) setComments(Array.isArray(j?.comments) ? j.comments : []); })
      .catch(() => { if (live) setComments([]); });
    return () => { live = false; };
  }, [type, target]);

  async function post(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/comments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, target, body: text }),
      }).catch(() => null);
      if (res?.ok) { setText(""); await load(); }
      else if (res?.status === 422) setError("Your comment was flagged by moderation. Please revise it.");
      else if (res?.status === 429) setError("You're commenting too fast - give it a moment.");
      else setError("Couldn't post your comment.");
    } finally {
      setBusy(false);
    }
  }

  async function del(id: string) {
    const res = await fetch("/api/comments", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    }).catch(() => null);
    if (res?.ok) await load();
  }

  return (
    <section className="comments">
      <h3 className="comments-title">Comments{comments ? ` (${comments.length})` : ""}</h3>

      <form className="comments-form" onSubmit={post}>
        <textarea
          className="comments-input"
          value={text}
          onChange={(e) => { setText(e.target.value); setError(null); }}
          placeholder="Add a comment or question..."
          rows={2}
          maxLength={1500}
        />
        <div className="comments-form-row">
          <button type="submit" className="btn primary" disabled={busy || !text.trim()}>{busy ? "Posting..." : "Post"}</button>
          {error && <span className="comments-error" role="alert">{error}</span>}
        </div>
      </form>

      {comments === null ? (
        <p className="dash-sub">Loading comments...</p>
      ) : comments.length === 0 ? (
        <p className="dash-sub">No comments yet. Start the discussion.</p>
      ) : (
        <ul className="comments-list">
          {comments.map((c) => (
            <li key={c.id} className="comment">
              <div className="comment-head">
                <span className="comment-author">{name(c.author)}</span>
                <span className="comment-time">{ago(c.at)}</span>
                {/* Ownership still compares ids. The name is presentation, and
                    two members can share one — it never decides authorship. */}
                {(admin || c.author === viewer) && (
                  <button type="button" className="link-btn link-danger comment-del" onClick={() => del(c.id)}>Delete</button>
                )}
              </div>
              <p className="comment-body">{c.body}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
