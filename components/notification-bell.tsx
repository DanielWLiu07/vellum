"use client";

import Link from "next/link";
import * as React from "react";

/**
 * The bell in the top bar: unread count, and a panel listing what happened.
 *
 * Reads /api/notifications, which answers only ever with the SIGNED viewer's
 * own mail - there is no parameter for anyone else's, deliberately (see the
 * route). So this component has no notion of "whose" notifications it is
 * showing; it shows the session's, and that is the whole authorisation story.
 *
 * Opening the panel does NOT mark everything read. Marking happens when the
 * member acts on a row, or explicitly via "Mark all read". A bell that clears
 * itself on a glance is how people miss the one message that mattered - the
 * count should mean "things you have not dealt with", not "things that have
 * flashed past your eyes".
 */

type Notification = {
  id: string;
  kind: string;
  title: string;
  body?: string;
  href?: string;
  count: number;
  createdAt: number;
  readAt: number | null;
};

/** Compact relative time; a notification list is scanned, not read closely. */
function when(ms: number): string {
  const s = Math.max(1, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** A short word per kind, so a row's nature reads before its text does. */
const KIND_LABEL: Record<string, string> = {
  "assignment.new": "Assigned",
  "assignment.done": "Completed",
  "assignment.reopened": "Reopened",
  "attempt.voided": "Exam voided",
  "share.new": "Shared",
  "admin.broadcast": "Announcement",
};

export function NotificationBell() {
  const [items, setItems] = React.useState<Notification[]>([]);
  const [unread, setUnread] = React.useState(0);
  const [open, setOpen] = React.useState(false);
  const [loaded, setLoaded] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement>(null);

  const load = React.useCallback(async () => {
    const res = await fetch("/api/notifications", { cache: "no-store" }).catch(() => null);
    if (!res || !res.ok) return;
    const j = await res.json().catch(() => null);
    if (!j || !Array.isArray(j.notifications)) return;
    setItems(j.notifications);
    setUnread(Number(j.unread) || 0);
    setLoaded(true);
  }, []);

  // Promise-chain rather than calling an async loader directly: setState must
  // land in a callback, not synchronously in the effect body. Same shape as
  // ProfileBadge, and `live` drops a response that arrives after unmount.
  React.useEffect(() => {
    let live = true;
    fetch("/api/notifications", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!live || !j || !Array.isArray(j.notifications)) return;
        setItems(j.notifications);
        setUnread(Number(j.unread) || 0);
        setLoaded(true);
      })
      .catch(() => {});
    return () => { live = false; };
  }, []);

  // Close on outside click and on Escape - a panel that traps the page is worse
  // than one that is a click away.
  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next) await load(); // freshen on open, not on a timer
  }

  async function readOne(n: Notification) {
    if (n.readAt !== null) return;
    // Optimistic: the row dims immediately. A failed PATCH is corrected by the
    // next load rather than by rolling the UI back under the member's cursor.
    setItems((list) => list.map((x) => (x.id === n.id ? { ...x, readAt: Date.now() } : x)));
    setUnread((u) => Math.max(0, u - 1));
    await fetch(`/api/notifications/${n.id}`, { method: "PATCH" }).catch(() => {});
  }

  async function readAll() {
    setItems((list) => list.map((x) => (x.readAt === null ? { ...x, readAt: Date.now() } : x)));
    setUnread(0);
    await fetch("/api/notifications", { method: "PATCH" }).catch(() => {});
    await load();
  }

  if (!loaded) return null;

  return (
    <div className="notif" ref={rootRef}>
      <button
        type="button"
        className="notif-bell"
        onClick={toggle}
        aria-expanded={open}
        aria-haspopup="true"
        aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
      >
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
          <path
            d="M12 3a5.5 5.5 0 0 0-5.5 5.5v3.2L5 15.2h14l-1.5-3.5V8.5A5.5 5.5 0 0 0 12 3Z"
            fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round"
          />
          <path d="M10 18a2 2 0 0 0 4 0" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        </svg>
        {unread > 0 && <span className="notif-dot">{unread > 9 ? "9+" : unread}</span>}
      </button>

      {open && (
        <div className="notif-panel" role="dialog" aria-label="Notifications">
          <div className="notif-head">
            <strong>Notifications</strong>
            {unread > 0 && (
              <button type="button" className="notif-readall" onClick={readAll}>
                Mark all read
              </button>
            )}
          </div>

          {items.length === 0 ? (
            <p className="notif-empty">Nothing yet. Work assigned to you will show up here.</p>
          ) : (
            <ul className="notif-list">
              {items.map((n) => {
                const label = KIND_LABEL[n.kind] ?? "Update";
                const row = (
                  <>
                    <span className="notif-row-top">
                      <span className="notif-kind">{label}</span>
                      <span className="notif-when">{when(n.createdAt)}</span>
                    </span>
                    <span className="notif-title">
                      {n.title}
                      {n.count > 1 && <span className="notif-count">×{n.count}</span>}
                    </span>
                    {n.body && <span className="notif-body">{n.body}</span>}
                  </>
                );
                return (
                  <li key={n.id} className={`notif-item${n.readAt === null ? " is-unread" : ""}`}>
                    {n.href ? (
                      <Link href={n.href} className="notif-link" onClick={() => void readOne(n)}>
                        {row}
                      </Link>
                    ) : (
                      <button type="button" className="notif-link" onClick={() => void readOne(n)}>
                        {row}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
