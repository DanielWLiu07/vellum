"use client";

/**
 * The moderation review surface.
 *
 * /api/moderation was complete and had no caller: content was being held for
 * review with nowhere to review it. Everything here is that missing half —
 * approve and reject hit the endpoint that already existed.
 *
 * Two layouts, because the queue is read two ways. Cards show the thumbnail,
 * which is how you judge an image or a scan without opening it; the list packs
 * more rows in when you're draining a backlog and reading titles.
 */

import * as React from "react";

import {
  isPreviewableKind,
  reviewOrder,
  statusBadge,
  summarize,
  triageOrder,
  type ReviewItem,
  type Tone,
} from "@/lib/moderation-view";

import { CardThumb } from "./card-thumb";

/**
 * Tones map onto the four badge colours the stylesheet has. Reported shares
 * `warn` with flagged — both are "someone says this is a problem", and the
 * label carries the difference — while submitted keeps `official` so a routine
 * publish request never looks like an accusation at a glance.
 */
function badgeClass(tone: Tone): string {
  if (tone === "flagged" || tone === "reported") return "badge-warn";
  if (tone === "ok") return "badge-ok";
  if (tone === "submitted") return "badge-official";
  return "badge-muted";
}

type Layout = "cards" | "list";
type Tab = "queue" | "posted" | "decided";

interface QueueResponse {
  configured: boolean;
  pending: ReviewItem[];
  history: ReviewItem[];
}

/** A live resource, as /api/docs reports it. */
interface PostedDoc {
  id: string;
  name: string;
  owner: string;
  visibility: string;
  thumbnailId?: string;
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

export function ModerationView() {
  const [data, setData] = React.useState<QueueResponse | null>(null);
  const [posted, setPosted] = React.useState<PostedDoc[]>([]);
  const [layout, setLayout] = React.useState<Layout>("cards");
  const [tab, setTab] = React.useState<Tab>("queue");
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);

  const load = React.useCallback(async () => {
    const [queueRes, docsRes] = await Promise.all([
      fetch("/api/moderation", { cache: "no-store" }).catch(() => null),
      fetch("/api/docs", { cache: "no-store" }).catch(() => null),
    ]);
    if (!queueRes) {
      setError("Couldn't reach the review queue.");
      setLoading(false);
      return;
    }
    if (!queueRes.ok) {
      setError(queueRes.status === 403 ? "Admins only." : "Couldn't load the review queue.");
      setLoading(false);
      return;
    }
    const body = await queueRes.json();
    setData({ configured: body.configured, pending: body.pending ?? [], history: body.history ?? [] });
    // What's live is DERIVED from visibility rather than tracked separately —
    // a second record of what is public is a second thing to drift.
    if (docsRes?.ok) {
      const docs = (await docsRes.json()).docs ?? [];
      setPosted(docs.filter((d: PostedDoc) => d.visibility === "public"));
    }
    setError(null);
    setLoading(false);
  }, []);

  // Every setState follows an await, same as the other data views.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  React.useEffect(() => { void load(); }, [load]);

  async function decide(id: string, action: "approve" | "reject") {
    setBusy(id);
    const res = await fetch("/api/moderation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, id }),
    }).catch(() => null);
    setBusy(null);
    if (!res?.ok) {
      setError(`Couldn't ${action} that item.`);
      return;
    }
    await load();
  }

  // Reported before flagged before unattended before routine, oldest-first
  // inside each band.
  const ordered = tab === "queue"
    ? triageOrder(data?.pending ?? [])
    : reviewOrder(data?.history ?? []);
  const counts = summarize(data?.pending ?? []);

  async function takeDown(id: string) {
    setBusy(id);
    const res = await fetch(`/api/doc/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ visibility: "private" }),
    }).catch(() => null);
    setBusy(null);
    if (!res?.ok) {
      setError("Couldn't take that down.");
      return;
    }
    await load();
  }

  return (
    <section className="role-section">
      <div className="section-head">
        <h2>Submissions</h2>
        <span className="section-count">
          {counts.pending} awaiting review · {posted.length} posted
        </span>
      </div>

      {counts.pending > 0 && (
        <p className="section-note">
          {counts.reported} reported by members · {counts.submitted} asking to publish ·{" "}
          {counts.flagged} flagged · {counts.unchecked} not checked. Reported items are shown first
          because they are the only ones still visible to everyone while they wait.
        </p>
      )}

      {data && !data.configured && (
        <p className="section-note">
          Automatic moderation is off (no API key), so nothing new is being held for content. Publish
          requests still come here for approval.
        </p>
      )}

      <div className="audit-filter" role="tablist" aria-label="Submissions">
        <button type="button" className={tab === "queue" ? "on" : ""} aria-pressed={tab === "queue"} onClick={() => setTab("queue")}>
          Awaiting review{counts.pending ? ` (${counts.pending})` : ""}
        </button>
        <button type="button" className={tab === "posted" ? "on" : ""} aria-pressed={tab === "posted"} onClick={() => setTab("posted")}>
          Posted{posted.length ? ` (${posted.length})` : ""}
        </button>
        <button type="button" className={tab === "decided" ? "on" : ""} aria-pressed={tab === "decided"} onClick={() => setTab("decided")}>
          Decided
        </button>
        {/* The layout flip. Cards to judge a picture, list to drain a backlog. */}
        <span style={{ marginLeft: "auto", display: "inline-flex", gap: 4 }}>
          <button type="button" className={layout === "cards" ? "on" : ""} aria-pressed={layout === "cards"} onClick={() => setLayout("cards")}>
            Cards
          </button>
          <button type="button" className={layout === "list" ? "on" : ""} aria-pressed={layout === "list"} onClick={() => setLayout("list")}>
            List
          </button>
        </span>
      </div>

      {error && <div className="empty-state">{error}</div>}

      {loading ? (
        <div className="empty-state">Loading...</div>
      ) : tab === "posted" ? (
        posted.length === 0 ? (
          <div className="empty-state">Nothing is published to everyone yet.</div>
        ) : layout === "cards" ? (
          <div className="tile-grid">
            {posted.map((d) => (
              <PostedCard key={d.id} doc={d} busy={busy === d.id} onTakeDown={takeDown} />
            ))}
          </div>
        ) : (
          <div className="table-card">
            {posted.map((d) => (
              <PostedRow key={d.id} doc={d} busy={busy === d.id} onTakeDown={takeDown} />
            ))}
          </div>
        )
      ) : ordered.length === 0 ? (
        <div className="empty-state">
          {tab === "queue" ? "Nothing is waiting for review." : "Nothing has been decided yet."}
        </div>
      ) : layout === "cards" ? (
        <div className="tile-grid">
          {ordered.map((item) => (
            <ReviewCard key={item.id} item={item} busy={busy === item.id} onDecide={decide} />
          ))}
        </div>
      ) : (
        <div className="table-card">
          {ordered.map((item) => (
            <ReviewRow key={item.id} item={item} busy={busy === item.id} onDecide={decide} />
          ))}
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------ posted */

function PostedCard({ doc, busy, onTakeDown }: {
  doc: PostedDoc;
  busy: boolean;
  onTakeDown: (id: string) => void;
}) {
  return (
    <div className="tile">
      <CardThumb
        cover={doc.thumbnailId}
        previewId={doc.id}
        previewable
        badge={<span className="badge badge-ok">Posted</span>}
      />
      <div className="tile-info">
        <p className="tile-title">{doc.name}</p>
        <p className="tile-sub">Live to every member · {doc.owner}</p>
      </div>
      <div className="tile-actions">
        <a className="btn" href={`/view/${doc.id}`} target="_blank" rel="noreferrer">Open</a>
        {/* Take down returns it to private rather than deleting: reversing a
            publish shouldn't destroy the owner's file. */}
        <button className="btn danger" disabled={busy} onClick={() => onTakeDown(doc.id)}>
          Take down
        </button>
      </div>
    </div>
  );
}

function PostedRow({ doc, busy, onTakeDown }: {
  doc: PostedDoc;
  busy: boolean;
  onTakeDown: (id: string) => void;
}) {
  return (
    <div className="member-row">
      <div className="member-id">
        <div>
          <p className="member-name">
            <span className="badge badge-ok">Posted</span> {doc.name}
          </p>
          <p className="member-email">Live to every member · {doc.owner}</p>
        </div>
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <a className="btn" href={`/view/${doc.id}`} target="_blank" rel="noreferrer">Open</a>
        <button className="btn danger" disabled={busy} onClick={() => onTakeDown(doc.id)}>
          Take down
        </button>
      </div>
    </div>
  );
}

function Actions({ item, busy, onDecide }: {
  item: ReviewItem;
  busy: boolean;
  onDecide: (id: string, action: "approve" | "reject") => void;
}) {
  if (item.status !== "pending") {
    return (
      <span className="member-frac">
        {item.reviewedAt ? ago(item.reviewedAt) : ""}
        {item.reviewedBy ? ` · ${item.reviewedBy}` : ""}
      </span>
    );
  }
  return (
    <>
      <a className="btn" href={`/view/${item.resourceId}`} target="_blank" rel="noreferrer">
        Open
      </a>
      <button className="btn primary" disabled={busy} onClick={() => onDecide(item.id, "approve")}>
        Approve
      </button>
      <button className="btn danger" disabled={busy} onClick={() => onDecide(item.id, "reject")}>
        Reject
      </button>
    </>
  );
}

function ReviewCard({ item, busy, onDecide }: {
  item: ReviewItem;
  busy: boolean;
  onDecide: (id: string, action: "approve" | "reject") => void;
}) {
  const badge = statusBadge(item);
  return (
    <div className="tile">
      <CardThumb
        previewId={item.resourceId}
        previewable={isPreviewableKind(item.kind)}
        badge={<span className={`badge ${badgeClass(badge.tone)}`}>{badge.label}</span>}
      />
      <div className="tile-info">
        <p className="tile-title">{item.title}</p>
        <p className="tile-sub">{badge.detail}</p>
        <p className="tile-sub">
          {item.kind} · {item.owner} · {ago(item.createdAt)}
        </p>
      </div>
      <div className="tile-actions">
        <Actions item={item} busy={busy} onDecide={onDecide} />
      </div>
    </div>
  );
}

function ReviewRow({ item, busy, onDecide }: {
  item: ReviewItem;
  busy: boolean;
  onDecide: (id: string, action: "approve" | "reject") => void;
}) {
  const badge = statusBadge(item);
  return (
    <div className="member-row">
      <div className="member-id">
        <div>
          <p className="member-name">
            <span className={`badge ${badgeClass(badge.tone)}`}>{badge.label}</span>{" "}
            {item.title}
          </p>
          <p className="member-email">
            {badge.detail} · {item.kind} · {item.owner} · {ago(item.createdAt)}
          </p>
        </div>
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <Actions item={item} busy={busy} onDecide={onDecide} />
      </div>
    </div>
  );
}
