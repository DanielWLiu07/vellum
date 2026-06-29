"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  ADMIN_STATS,
  ADMIN_USERS,
  ADVISOR_TRAINERS,
  ROLES,
  STUDENT_ASSIGNMENTS,
  TRAINER_ROSTER,
  type AdminUser,
  type Role,
} from "@/lib/demo-data";

interface Doc {
  id: string;
  name: string;
  sizeBytes: number;
  uploadedAt: number;
  bundled: boolean;
}

/* ---------------------------------------------------------------- toasts */

let toastSeq = 0;
function useToasts() {
  const [toasts, setToasts] = useState<{ id: number; msg: string }[]>([]);
  const notify = useCallback((msg: string) => {
    const id = ++toastSeq;
    setToasts((t) => [...t, { id, msg }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2600);
  }, []);
  const node = (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className="toast">{t.msg}</div>
      ))}
    </div>
  );
  return { notify, node };
}

/** Close a modal/overlay when Escape is pressed. */
function useEscape(onClose: () => void) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);
}

/**
 * Dialog focus management: Escape to close, Tab trapped within the modal,
 * first control focused on open, and focus restored to the trigger on close.
 * Returns a ref to attach to the modal's content element.
 */
function useModal(onClose: () => void) {
  useEscape(onClose);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = ref.current;
    const restoreTo = document.activeElement as HTMLElement | null;
    const selector =
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const focusables = () => (root ? Array.from(root.querySelectorAll<HTMLElement>(selector)) : []);
    focusables()[0]?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const items = focusables();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    root?.addEventListener("keydown", onKey);
    return () => {
      root?.removeEventListener("keydown", onKey);
      restoreTo?.focus?.();
    };
  }, []);
  return ref;
}

/* ---------------------------------------------------------------- main */

export function Dashboard() {
  const [role, setRole] = useState<Role>("student");
  const [docs, setDocs] = useState<Doc[]>([]);
  const [viewer, setViewer] = useState<string | null>(null);
  const [shareDoc, setShareDoc] = useState<Doc | null>(null);
  const [assignTo, setAssignTo] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const { notify, node: toastNode } = useToasts();

  const refresh = useCallback(async () => {
    const res = await fetch("/api/docs", { cache: "no-store" }).catch(() => null);
    if (res?.ok) {
      setDocs((await res.json()).docs);
      setLoadError(false);
    } else {
      setLoadError(true);
    }
    setLoading(false);
  }, []);
  // Load the document list on mount. refresh() only setState()s after its
  // fetch awaits, so the cascading-render concern the rule guards against
  // doesn't apply here.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void refresh(); }, [refresh]);

  // Manual re-fetch (Retry button): show the skeleton again, then reload.
  const onRetry = useCallback(() => {
    setLoading(true);
    setLoadError(false);
    void refresh();
  }, [refresh]);

  const view = useCallback(async (docId: string, watermark = "") => {
    const res = await fetch("/api/share", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: docId, watermark, ttlMinutes: 15 }),
    });
    if (res.ok) setViewer((await res.json()).embedUrl);
    else notify("Couldn't open the document.");
  }, [notify]);

  const onUpload = async (file: File) => {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.set("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      if (res.ok) { await refresh(); notify(`Uploaded ${file.name}`); }
      else notify("Upload failed — PDFs only, 25 MB max.");
    } finally {
      setUploading(false);
    }
  };
  const pickFile = () => fileRef.current?.click();

  const onDelete = useCallback(async (doc: Doc) => {
    if (typeof window !== "undefined" && !window.confirm(`Delete "${doc.name}"? This can't be undone.`)) return;
    const res = await fetch(`/api/doc/${doc.id}`, { method: "DELETE" }).catch(() => null);
    if (res?.ok) { await refresh(); notify(`Deleted ${doc.name}`); }
    else notify("Couldn't delete the document.");
  }, [refresh, notify]);

  const active = ROLES.find((r) => r.id === role)!;
  const shared = {
    docs, onView: view, onShare: setShareDoc, onDelete, onUploadClick: pickFile,
    uploading, loading, loadError, onRetry,
  };

  return (
    <div className="dash">
      <div className="role-switch" role="tablist" aria-label="Preview as role">
        <span className="role-switch-label">Preview as</span>
        {ROLES.map((r) => (
          <button key={r.id} role="tab" aria-selected={role === r.id}
            className={role === r.id ? "role-chip is-active" : "role-chip"}
            onClick={() => { setRole(r.id); setViewer(null); }}>
            {r.label}
          </button>
        ))}
      </div>
      <p className="dash-sub" style={{ marginBottom: 24 }}>{active.blurb}</p>

      {role === "student" && <StudentView docs={docs} onView={view} onStart={(t) => notify(`Opening "${t}" (demo)`)} />}
      {role === "trainer" && <TrainerView {...shared} onAssign={setAssignTo} />}
      {role === "advisor" && <AdvisorView {...shared} onManage={(n) => notify(`Managing ${n} (demo)`)} />}
      {role === "admin" && <AdminView {...shared} onRole={(n, r) => notify(`${n} → ${r}`)} />}

      {viewer && <ViewerModal src={viewer} onClose={() => setViewer(null)} />}

      {shareDoc && <ShareModal doc={shareDoc} onClose={() => setShareDoc(null)} onView={view} notify={notify} />}
      {assignTo && (
        <AssignModal
          memberName={TRAINER_ROSTER.find((m) => m.id === assignTo)?.name ?? "member"}
          docs={docs}
          onClose={() => setAssignTo(null)}
          onAssign={(title, name) => { setAssignTo(null); notify(`Assigned "${title}" to ${name}`); }}
        />
      )}

      <input ref={fileRef} type="file" accept="application/pdf" hidden
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void onUpload(f); }} />
      {toastNode}
    </div>
  );
}

/* ---------------------------------------------------------------- shared bits */

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, [string, string]> = {
    done: ["Done", "ok"], in_progress: ["In progress", "warn"], not_started: ["To do", "muted"],
  };
  const [label, tone] = map[status] ?? [status, "muted"];
  return <span className={`badge badge-${tone}`}>{label}</span>;
}
function ProgressBar({ value }: { value: number }) {
  return <div className="bar" aria-label={`${value}%`}><div className="bar-fill" style={{ width: `${value}%` }} /></div>;
}
function LessonCard({ title, sub, badge, actions }: { title: string; sub: string; badge?: React.ReactNode; actions: React.ReactNode }) {
  return (
    <div className="lesson-card">
      <div className="lesson-icon" aria-hidden>▤</div>
      <div className="lesson-body"><p className="lesson-title">{title}</p><p className="lesson-sub">{sub}</p></div>
      <div className="lesson-end">{badge}{actions}</div>
    </div>
  );
}

type SharedProps = {
  docs: Doc[];
  onView: (id: string, wm?: string) => void;
  onShare: (d: Doc) => void;
  onDelete: (d: Doc) => void;
  onUploadClick: () => void;
  uploading: boolean;
  loading: boolean;
  loadError: boolean;
  onRetry: () => void;
};

function DocManager({ docs, onView, onShare, onDelete, onUploadClick, uploading, loading, loadError, onRetry, heading, canUpload = true }: SharedProps & { heading: string; canUpload?: boolean }) {
  return (
    <section className="role-section">
      <div className="section-head">
        <h2>{heading}</h2>
        {canUpload && <button className="cta" disabled={uploading} onClick={onUploadClick}>{uploading ? "Uploading…" : "+ Upload PDF"}</button>}
      </div>
      <div className="lesson-grid">
        {loading ? (
          [0, 1, 2].map((i) => (
            <div key={i} className="lesson-card skeleton" aria-hidden>
              <div className="lesson-icon">▤</div>
              <div className="lesson-body"><p className="lesson-title">Loading…</p><p className="lesson-sub">&nbsp;</p></div>
            </div>
          ))
        ) : loadError ? (
          <div className="empty-state">
            Couldn’t load documents. <button className="btn" onClick={onRetry}>Retry</button>
          </div>
        ) : docs.length === 0 ? (
          <div className="empty-state">No documents yet. {canUpload && "Click + Upload PDF to add one."}</div>
        ) : (
          docs.map((d) => (
            <LessonCard key={d.id} title={d.name} sub={`${d.bundled ? "Sample" : "Uploaded"} · ${(d.sizeBytes / 1024).toFixed(0)} KB`}
              actions={<>
                <button className="btn" onClick={() => onShare(d)}>Share</button>
                <button className="btn primary" onClick={() => onView(d.id)}>View</button>
                {!d.bundled && <button className="btn danger" onClick={() => onDelete(d)}>Delete</button>}
              </>} />
          ))
        )}
      </div>
    </section>
  );
}

function ViewerModal({ src, onClose }: { src: string; onClose: () => void }) {
  const ref = useModal(onClose);
  return (
    <div className="viewer-modal-backdrop" onClick={onClose}>
      <div className="viewer-modal" ref={ref} role="dialog" aria-modal="true" aria-label="Document viewer" onClick={(e) => e.stopPropagation()}>
        <button className="viewer-close" onClick={onClose} aria-label="Close">✕</button>
        <iframe key={src} className="viewer-modal-frame" src={src} title="Lesson viewer" sandbox="allow-scripts allow-same-origin" />
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- role views */

function StudentView({ docs, onView, onStart }: { docs: Doc[]; onView: (id: string, wm?: string) => void; onStart: (title: string) => void }) {
  const done = STUDENT_ASSIGNMENTS.filter((a) => a.status === "done").length;
  const total = STUDENT_ASSIGNMENTS.length;
  const pct = Math.round((done / total) * 100);
  const next = STUDENT_ASSIGNMENTS.find((a) => a.status !== "done");
  return (
    <>
      {/* At-a-glance stats */}
      <div className="stat-grid">
        <div className="stat-card"><p className="stat-value">{total - done}</p><p className="stat-label">To do</p></div>
        <div className="stat-card"><p className="stat-value">{done}</p><p className="stat-label">Completed</p></div>
        <div className="stat-card"><p className="stat-value">{pct}%</p><p className="stat-label">Progress</p></div>
        <div className="stat-card"><p className="stat-value">{docs.length}</p><p className="stat-label">Content available</p></div>
      </div>

      {/* Up next — one clear call to action */}
      {next && (
        <div className="lesson-card" style={{ borderColor: "var(--teal)" }}>
          <div className="lesson-icon" aria-hidden>▶</div>
          <div className="lesson-body">
            <p className="lesson-sub">Up next</p>
            <p className="lesson-title">{next.title}</p>
          </div>
          <div className="lesson-end">
            <button className="btn primary" onClick={() => (next.kind === "document" && next.docId ? onView(next.docId) : onStart(next.title))}>
              {next.status === "in_progress" ? "Continue" : "Start"}
            </button>
          </div>
        </div>
      )}

      {/* Assigned to you */}
      <section className="role-section">
        <div className="section-head"><h2>Assigned to you</h2><span className="section-count">{done} of {total} complete</span></div>
        <div className="progress-banner"><ProgressBar value={pct} /><span>{pct}%</span></div>
        <div className="lesson-grid">
          {STUDENT_ASSIGNMENTS.map((a) => (
            <LessonCard key={a.id} title={a.title}
              sub={`${a.kind === "quiz" ? "Quiz" : "Lesson"} · ${a.from}${a.due ? ` · due ${a.due}` : ""}`}
              badge={<StatusBadge status={a.status} />}
              actions={a.kind === "document" && a.docId
                ? <button className="btn primary" onClick={() => onView(a.docId!)}>Open</button>
                : <button className="btn primary" onClick={() => onStart(a.title)}>{a.status === "done" ? "Review" : "Start"}</button>} />
          ))}
        </div>
      </section>

      {/* All general content — every student can open these */}
      <section className="role-section">
        <div className="section-head"><h2>All content</h2><span className="section-count">{docs.length} available to everyone</span></div>
        <p className="dash-sub" style={{ marginTop: -4, marginBottom: 12 }}>General resources every student can open anytime.</p>
        <div className="lesson-grid">
          {docs.map((d) => (
            <LessonCard key={d.id} title={d.name}
              sub={`${d.bundled ? "General resource" : "Shared"} · PDF`}
              actions={<button className="btn primary" onClick={() => onView(d.id)}>Open</button>} />
          ))}
          {docs.length === 0 && <div className="empty-state">No content available yet.</div>}
        </div>
      </section>
    </>
  );
}

function TrainerView({ onAssign, ...shared }: SharedProps & { onAssign: (memberId: string) => void }) {
  return (
    <>
      <DocManager {...shared} heading="My lessons" />
      <section className="role-section">
        <div className="section-head"><h2>My group</h2><span className="section-count">{TRAINER_ROSTER.length} members</span></div>
        <div className="table-card">
          {TRAINER_ROSTER.map((m) => (
            <div key={m.id} className="member-row">
              <div className="member-id"><span className="avatar">{initials(m.name)}</span>
                <div><p className="member-name">{m.name}</p><p className="member-email">{m.email}</p></div></div>
              <div className="member-progress"><ProgressBar value={Math.round((m.done / m.assigned) * 100)} /><span className="member-frac">{m.done}/{m.assigned}</span></div>
              <button className="btn primary" onClick={() => onAssign(m.id)}>Assign</button>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

function AdvisorView({ onManage, ...shared }: SharedProps & { onManage: (name: string) => void }) {
  return (
    <>
      <section className="role-section">
        <div className="section-head"><h2>My chapter · trainers</h2><span className="section-count">{ADVISOR_TRAINERS.length} trainers</span></div>
        <div className="table-card">
          {ADVISOR_TRAINERS.map((t) => (
            <div key={t.id} className="member-row">
              <div className="member-id"><span className="avatar">{initials(t.name)}</span>
                <div><p className="member-name">{t.name}</p><p className="member-email">{t.members} members</p></div></div>
              <div className="member-progress"><ProgressBar value={t.completion} /><span className="member-frac">{t.completion}%</span></div>
              <button className="btn" onClick={() => onManage(t.name)}>Manage</button>
            </div>
          ))}
        </div>
      </section>
      <DocManager {...shared} heading="Chapter lessons" />
    </>
  );
}

function AdminView({ onRole, ...shared }: SharedProps & { onRole: (name: string, role: string) => void }) {
  const [users, setUsers] = useState<AdminUser[]>(ADMIN_USERS);
  return (
    <>
      <div className="stat-grid">
        {ADMIN_STATS.map((s) => <div key={s.label} className="stat-card"><p className="stat-value">{s.value}</p><p className="stat-label">{s.label}</p></div>)}
      </div>
      <section className="role-section">
        <div className="section-head"><h2>All users</h2><span className="section-count">change any role</span></div>
        <div className="table-card">
          {users.map((u) => (
            <div key={u.id} className="member-row">
              <div className="member-id"><span className="avatar">{initials(u.name)}</span>
                <div><p className="member-name">{u.name}</p><p className="member-email">{u.email}</p></div></div>
              <select className="role-select" value={u.role}
                onChange={(e) => { const r = e.target.value as Role; setUsers((p) => p.map((x) => x.id === u.id ? { ...x, role: r } : x)); onRole(u.name, ROLES.find((x) => x.id === r)!.label); }}>
                {ROLES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
              </select>
            </div>
          ))}
        </div>
      </section>
      <DocManager {...shared} heading="All documents" />
    </>
  );
}

/* ---------------------------------------------------------------- modals */

function ShareModal({ doc, onClose, onView, notify }: { doc: Doc; onClose: () => void; onView: (id: string, wm?: string) => void; notify: (m: string) => void }) {
  const [watermark, setWatermark] = useState("");
  const [ttl, setTtl] = useState(15);
  const [download, setDownload] = useState(false);
  const [print, setPrint] = useState(false);
  const [slides, setSlides] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const ref = useModal(onClose);

  const mint = async () => {
    const res = await fetch("/api/share", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: doc.id, watermark, download, print, mode: slides ? "slides" : "scroll", ttlMinutes: ttl }) });
    return res.ok ? (await res.json()).embedUrl as string : null;
  };

  return (
    <div className="dash-modal-backdrop" onClick={onClose}>
      <div className="dash-modal" ref={ref} role="dialog" aria-modal="true" aria-label={`Share ${doc.name}`} onClick={(e) => e.stopPropagation()}>
        <h2>Share “{doc.name}”</h2>
        <p className="dash-muted" style={{ padding: 0, marginTop: 4 }}>The link carries a signed token — it expires and can’t be edited.</p>
        <label className="dash-field"><span>Watermark (shown on every page)</span>
          <input value={watermark} placeholder="e.g. Daniel Liu • confidential" onChange={(e) => setWatermark(e.target.value)} /></label>
        <label className="dash-field"><span>Link expires in (minutes)</span>
          <input type="number" min={1} max={60} value={ttl} onChange={(e) => setTtl(Number(e.target.value))} /></label>
        <div className="dash-checks">
          <label><input type="checkbox" checked={download} onChange={(e) => setDownload(e.target.checked)} /> Allow download</label>
          <label><input type="checkbox" checked={print} onChange={(e) => setPrint(e.target.checked)} /> Allow print</label>
          <label><input type="checkbox" checked={slides} onChange={(e) => setSlides(e.target.checked)} /> Open as slideshow</label>
        </div>
        <div className="dash-modal-actions">
          <button className="cta secondary" onClick={onClose}>Cancel</button>
          <button className="cta secondary" disabled={busy} onClick={async () => { setBusy(true); const u = await mint(); setBusy(false); if (u) { onClose(); onView(doc.id, watermark); } }}>Preview</button>
          <button className="cta" disabled={busy} onClick={async () => {
            setBusy(true);
            const u = await mint();
            setBusy(false);
            if (u) {
              await navigator.clipboard.writeText(location.origin + u).catch(() => {});
              notify("Secure link copied");
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }
          }}>{copied ? "Copied ✓" : "Copy link"}</button>
        </div>
      </div>
    </div>
  );
}

function AssignModal({ memberName, docs, onClose, onAssign }: { memberName: string; docs: Doc[]; onClose: () => void; onAssign: (title: string, name: string) => void }) {
  const ref = useModal(onClose);
  return (
    <div className="dash-modal-backdrop" onClick={onClose}>
      <div className="dash-modal" ref={ref} role="dialog" aria-modal="true" aria-label={`Assign a lesson to ${memberName}`} onClick={(e) => e.stopPropagation()}>
        <h2>Assign a lesson to {memberName}</h2>
        <p className="dash-muted" style={{ padding: 0, marginTop: 4 }}>Pick a lesson to add to their queue.</p>
        <div className="assign-list">
          {docs.map((d) => (
            <button key={d.id} className="assign-row" onClick={() => onAssign(d.name, memberName)}>
              <span className="lesson-icon" aria-hidden>▤</span>
              <span>{d.name}</span>
              <span className="assign-add">Assign →</span>
            </button>
          ))}
          {docs.length === 0 && <p className="dash-muted">Upload a lesson first.</p>}
        </div>
        <div className="dash-modal-actions"><button className="cta secondary" onClick={onClose}>Close</button></div>
      </div>
    </div>
  );
}

function initials(name: string): string {
  return name.split(" ").map((p) => p[0]).join("").slice(0, 2);
}
