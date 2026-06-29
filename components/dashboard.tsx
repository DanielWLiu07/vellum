"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { ActivityLog } from "./activity-log";
import { FlashcardsView } from "./flashcards-view";
import { QuizzesView } from "./quizzes-view";
import {
  DEMO_VIEWER,
  VISIBILITIES,
  filterScoped,
  type FilterMode,
  type Visibility,
} from "@/lib/visibility";
import {
  ADMIN_STATS,
  ADMIN_USERS,
  ADVISOR_TRAINERS,
  CHAPTER,
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
  visibility: Visibility;
  chapter: string;
  owner: string;
  thumbnailId?: string;
}

const VIS_LABEL: Record<Visibility, string> = { public: "Public", chapter: "Chapter", private: "Private" };

const FILTERS: { id: FilterMode; label: string }[] = [
  { id: "accessible", label: "All resources" },
  { id: "mine", label: "My resources" },
];

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

type NavItem = { id: string; label: string; soon?: boolean };

// Left-nav sections per role. `soon` items are round-2 features (not built yet).
const NAV: Record<Role, NavItem[]> = {
  student: [
    { id: "home", label: "Home" },
    { id: "assignments", label: "My assignments" },
    { id: "resources", label: "Resources" },
    { id: "flashcards", label: "Flashcards" },
    { id: "quizzes", label: "Quizzes" },
    { id: "skills", label: "General skills", soon: true },
  ],
  trainer: [
    { id: "lessons", label: "My lessons" },
    { id: "group", label: "My group" },
    { id: "flashcards", label: "Flashcards" },
    { id: "quizzes", label: "Quizzes" },
    { id: "skills", label: "General skills", soon: true },
  ],
  advisor: [
    { id: "trainers", label: "Trainers" },
    { id: "lessons", label: "Chapter lessons" },
  ],
  admin: [
    { id: "overview", label: "Overview" },
    { id: "users", label: "Users & roles" },
    { id: "content", label: "All content" },
    { id: "access", label: "Roles & access" },
    { id: "activity", label: "Activity log" },
    { id: "settings", label: "Settings" },
  ],
};

const ADMIN_SETTINGS = [
  { label: "Allow student uploads", desc: "Let students submit their own documents", on: false },
  { label: "Require watermark on shares", desc: "Force a per-user watermark on every shared link", on: true },
  { label: "Enable General skills (round 2)", desc: "Buzzer game, skills in front of AI, and more", on: false },
];

function ComingSoon({ title, note }: { title: string; note?: string }) {
  return (
    <div className="coming-soon" data-testid="coming-soon">
      <span className="coming-soon-badge">Round 2</span>
      <p className="coming-soon-title">{title}</p>
      <p className="coming-soon-sub">{note ?? "Coming soon - this feature isn't built yet."}</p>
    </div>
  );
}

export function Dashboard() {
  const [role, setRole] = useState<Role>("student");
  const [section, setSection] = useState<string>("home");
  const [docs, setDocs] = useState<Doc[]>([]);
  const [viewer, setViewer] = useState<string | null>(null);
  const [shareDoc, setShareDoc] = useState<Doc | null>(null);
  const [shareScopeDoc, setShareScopeDoc] = useState<Doc | null>(null);
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

  // Deep-link support: ?role=&section= opens a specific view (e.g. the upload
  // page). Runs once on mount, reading state from the URL before setState.
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const r = p.get("role");
    if (!r || !ROLES.some((x) => x.id === r)) return;
    const nextRole = r as Role;
    const s = p.get("section");
    const nextSection = s && NAV[nextRole].some((n) => n.id === s) ? s : NAV[nextRole][0]!.id;
    /* eslint-disable react-hooks/set-state-in-effect */
    setRole(nextRole);
    setSection(nextSection);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

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
      else notify("Upload failed - PDFs only, 25 MB max.");
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
      <div className="dash-shell">
        <aside className="dash-sidebar">
          <div className="dash-role-select">
            <span className="role-switch-label">Preview as</span>
            <select
              className="role-select"
              value={role}
              aria-label="Preview as role"
              onChange={(e) => {
                const r = e.target.value as Role;
                setRole(r);
                setSection(NAV[r][0]!.id);
                setViewer(null);
              }}
            >
              {ROLES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
            </select>
          </div>
          <nav className="dash-nav" aria-label="Sections">
            {NAV[role].map((item) => (
              <button
                key={item.id}
                type="button"
                className={`dash-nav-item${section === item.id ? " is-active" : ""}${item.soon ? " is-soon" : ""}`}
                aria-current={section === item.id}
                data-testid={`nav-${item.id}`}
                onClick={() => setSection(item.id)}
              >
                <span className="dash-nav-label">{item.label}</span>
                {item.soon && <span className="dash-nav-soon">Soon</span>}
              </button>
            ))}
            <Link href="/guidelines" className="dash-nav-item dash-nav-link" data-testid="nav-guidelines">
              <span className="dash-nav-label">Guidelines</span>
            </Link>
          </nav>
        </aside>

        <main className="dash-main">
          <p className="dash-sub" style={{ marginBottom: 20 }}>{active.blurb}</p>
          {role === "student" && <StudentView section={section} docs={docs} onView={view} onStart={(t) => notify(`Opening "${t}" (demo)`)} uploading={uploading} onUploadClick={pickFile} onShareScope={setShareScopeDoc} />}
          {role === "trainer" && <TrainerView section={section} {...shared} onAssign={setAssignTo} />}
          {role === "advisor" && <AdvisorView section={section} {...shared} onManage={(n) => notify(`Managing ${n} (demo)`)} />}
          {role === "admin" && <AdminView section={section} {...shared} onRole={(n, r) => notify(`${n} → ${r}`)} />}
        </main>
      </div>

      {viewer && <ViewerModal src={viewer} onClose={() => setViewer(null)} />}

      {shareDoc && <ShareModal doc={shareDoc} onClose={() => setShareDoc(null)} onView={view} notify={notify} />}
      {shareScopeDoc && (
        <ShareScopeModal
          doc={shareScopeDoc}
          onClose={() => setShareScopeDoc(null)}
          onSaved={(v) => { setShareScopeDoc(null); notify(`Sharing set to ${v}`); void refresh(); }}
        />
      )}
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
function LessonCard({ title, sub, badge, actions, thumbId }: { title: string; sub: string; badge?: React.ReactNode; actions: React.ReactNode; thumbId?: string }) {
  return (
    <div className="tile">
      <div className="tile-thumb">
        {thumbId ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="tile-cover" src={`/api/images/${thumbId}`} alt="" />
        ) : (
          <div className="tile-preview" aria-hidden>
            <span className="tile-line" />
            <span className="tile-line" />
            <span className="tile-line short" />
          </div>
        )}
        {badge && <span className="tile-badge">{badge}</span>}
      </div>
      <div className="tile-info"><p className="tile-title">{title}</p><p className="tile-sub">{sub}</p></div>
      <div className="tile-actions">{actions}</div>
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
        {canUpload && <button className="cta" disabled={uploading} onClick={onUploadClick}>{uploading ? "Uploading..." : "+ Upload PDF"}</button>}
      </div>
      <div className="tile-grid">
        {loading ? (
          [0, 1, 2].map((i) => (
            <div key={i} className="tile skeleton" aria-hidden>
              <div className="tile-thumb"><div className="tile-preview" /></div>
              <div className="tile-info"><p className="tile-title">Loading...</p><p className="tile-sub">&nbsp;</p></div>
            </div>
          ))
        ) : loadError ? (
          <div className="empty-state">
            Could not load documents. <button className="btn" onClick={onRetry}>Retry</button>
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

function StudentView({ section, docs, onView, onStart, uploading, onUploadClick, onShareScope }: { section: string; docs: Doc[]; onView: (id: string, wm?: string) => void; onStart: (title: string) => void; uploading: boolean; onUploadClick: () => void; onShareScope: (d: Doc) => void }) {
  const done = STUDENT_ASSIGNMENTS.filter((a) => a.status === "done").length;
  const total = STUDENT_ASSIGNMENTS.length;
  const pct = Math.round((done / total) * 100);
  const next = STUDENT_ASSIGNMENTS.find((a) => a.status !== "done");
  const [q, setQ] = useState("");
  const [mode, setMode] = useState<FilterMode>("accessible");

  if (section === "home") {
    return (
      <>
        <div className="chapter-card">
          <div className="chapter-head">
            <div>
              <p className="chapter-name">{CHAPTER.name}</p>
              <p className="chapter-region">{CHAPTER.region}</p>
            </div>
            <span className="chapter-members">{CHAPTER.members} members</span>
          </div>
          <div className="chapter-facts">
            <div><span className="chapter-label">Advisor</span><span>{CHAPTER.advisor}</span></div>
            <div><span className="chapter-label">Next event</span><span>{CHAPTER.nextEvent.name} · {CHAPTER.nextEvent.date}</span></div>
          </div>
          <p className="chapter-note">{CHAPTER.announcement}</p>
        </div>

        <div className="stat-grid">
          <div className="stat-card"><p className="stat-value">{total - done}</p><p className="stat-label">To do</p></div>
          <div className="stat-card"><p className="stat-value">{done}</p><p className="stat-label">Completed</p></div>
          <div className="stat-card"><p className="stat-value">{pct}%</p><p className="stat-label">Progress</p></div>
          <div className="stat-card"><p className="stat-value">{docs.length}</p><p className="stat-label">Content available</p></div>
        </div>
        {next && (
          <div className="lesson-card" style={{ borderColor: "var(--teal)" }}>
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
      </>
    );
  }

  if (section === "assignments") {
    return (
      <section className="role-section">
        <div className="section-head"><h2>Assigned to you</h2><span className="section-count">{done} of {total} complete</span></div>
        <div className="progress-banner"><ProgressBar value={pct} /><span>{pct}%</span></div>
        <div className="tile-grid">
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
    );
  }

  if (section === "resources") {
    const term = q.trim().toLowerCase();
    const counts: Record<FilterMode, number> = {
      accessible: filterScoped(docs, DEMO_VIEWER, "accessible").length,
      mine: filterScoped(docs, DEMO_VIEWER, "mine").length,
      public: 0,
      chapter: 0,
    };
    const visible = filterScoped(docs, DEMO_VIEWER, mode).filter(
      (d) => !term || d.name.toLowerCase().includes(term),
    );
    const mineEmpty = mode === "mine" && visible.length === 0 && !term;
    return (
      <section className="role-section">
        <div className="section-head">
          <h2>Resources</h2>
          <button className="cta" disabled={uploading} onClick={onUploadClick}>
            {uploading ? "Uploading..." : "+ Upload a resource"}
          </button>
        </div>
        <div className="seg-toggle" role="tablist" aria-label="Resource scope">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              role="tab"
              aria-selected={mode === f.id}
              className={`seg-btn${mode === f.id ? " is-active" : ""}`}
              onClick={() => setMode(f.id)}
            >
              {f.label} <span className="seg-count">{counts[f.id]}</span>
            </button>
          ))}
        </div>
        <p className="dash-sub" style={{ marginTop: 10, marginBottom: 12 }}>
          {mode === "mine"
            ? "Files you uploaded. They start private; use Share to let your chapter or everyone see them."
            : `Everything shared with you, viewing as a member of ${DEMO_VIEWER.chapter}.`}
        </p>
        <div className="resource-toolbar">
          <input
            className="search-input"
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search resources"
            aria-label="Search resources"
          />
        </div>
        <div className="tile-grid">
          {visible.map((d) => (
            <LessonCard key={d.id} title={d.name} thumbId={d.thumbnailId}
              badge={<span className={`badge badge-${d.visibility === "public" ? "ok" : d.visibility === "chapter" ? "warn" : "muted"}`}>{VIS_LABEL[d.visibility]}</span>}
              sub={`${d.bundled ? "HOSA official" : d.owner === DEMO_VIEWER.owner ? "Your upload" : "Shared by a member"}${d.visibility === "chapter" && d.chapter ? ` · ${d.chapter}` : ""}`}
              actions={
                <>
                  <button className="btn primary" onClick={() => onView(d.id)}>Open</button>
                  {d.owner === DEMO_VIEWER.owner && <button className="btn" onClick={() => onShareScope(d)}>Share</button>}
                </>
              } />
          ))}
          {mineEmpty
            ? <div className="empty-state">You have not uploaded anything yet. Use Upload a resource to add one.</div>
            : visible.length === 0 && <div className="empty-state">No resources match.</div>}
        </div>
      </section>
    );
  }

  if (section === "flashcards") return <FlashcardsView />;
  if (section === "quizzes") return <QuizzesView />;

  return <ComingSoon title="General skills" note="Round-2 practice - the buzzer game, doing skills in front of AI, and more. Coming soon." />;
}

function TrainerView({ section, onAssign, ...shared }: SharedProps & { section: string; onAssign: (memberId: string) => void }) {
  if (section === "lessons") return <DocManager {...shared} docs={filterScoped(shared.docs, DEMO_VIEWER, "accessible")} heading="My lessons" />;
  if (section === "group") {
    return (
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
    );
  }
  if (section === "flashcards") return <FlashcardsView />;
  if (section === "quizzes") return <QuizzesView />;

  return <ComingSoon title="General skills" note="Round-2 practice - the buzzer game, skills in front of AI, and more. Coming soon." />;
}

function AdvisorView({ section, onManage, ...shared }: SharedProps & { section: string; onManage: (name: string) => void }) {
  if (section === "lessons") return <DocManager {...shared} docs={filterScoped(shared.docs, DEMO_VIEWER, "accessible")} heading="Chapter lessons" />;
  if (section === "trainers") {
    return (
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
    );
  }
  return <ComingSoon title={section} />;
}

function AdminView({ section, onRole, ...shared }: SharedProps & { section: string; onRole: (name: string, role: string) => void }) {
  const [users, setUsers] = useState<AdminUser[]>(ADMIN_USERS);
  const [settings, setSettings] = useState(ADMIN_SETTINGS);
  if (section === "overview") {
    return (
      <div className="stat-grid">
        {ADMIN_STATS.map((s) => <div key={s.label} className="stat-card"><p className="stat-value">{s.value}</p><p className="stat-label">{s.label}</p></div>)}
      </div>
    );
  }
  if (section === "users") {
    return (
      <section className="role-section">
        <div className="section-head"><h2>Users &amp; roles</h2><span className="section-count">{users.length} users · change any role</span></div>
        <div className="table-card">
          {users.map((u) => (
            <div key={u.id} className="member-row">
              <div className="member-id"><span className="avatar">{initials(u.name)}</span>
                <div><p className="member-name">{u.name}</p><p className="member-email">{u.email}</p></div></div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <select className="role-select" value={u.role}
                  onChange={(e) => { const r = e.target.value as Role; setUsers((p) => p.map((x) => x.id === u.id ? { ...x, role: r } : x)); onRole(u.name, ROLES.find((x) => x.id === r)!.label); }}>
                  {ROLES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
                </select>
                <button className="btn" onClick={() => setUsers((p) => p.filter((x) => x.id !== u.id))}>Remove</button>
              </div>
            </div>
          ))}
        </div>
      </section>
    );
  }
  if (section === "content") return <DocManager {...shared} heading="All content" />;
  if (section === "access") {
    return (
      <section className="role-section">
        <div className="section-head"><h2>Roles &amp; access</h2><span className="section-count">what each role can do</span></div>
        <div className="table-card">
          {ROLES.map((r) => (
            <div key={r.id} className="member-row">
              <div className="member-id"><div><p className="member-name">{r.label}</p><p className="member-email">{r.blurb}</p></div></div>
              <span className={`badge ${r.id === "admin" ? "badge-ok" : "badge-muted"}`}>{r.id === "admin" ? "Full control" : "Scoped"}</span>
            </div>
          ))}
        </div>
      </section>
    );
  }
  if (section === "activity") return <ActivityLog />;
  if (section === "settings") {
    return (
      <section className="role-section">
        <div className="section-head"><h2>Settings</h2><span className="section-count">platform configuration</span></div>
        <div className="table-card">
          {settings.map((s, i) => (
            <label key={s.label} className="member-row" style={{ cursor: "pointer" }}>
              <div className="member-id"><div><p className="member-name">{s.label}</p><p className="member-email">{s.desc}</p></div></div>
              <input
                type="checkbox"
                checked={s.on}
                aria-label={s.label}
                onChange={() => setSettings((p) => p.map((x, j) => (j === i ? { ...x, on: !x.on } : x)))}
              />
            </label>
          ))}
        </div>
      </section>
    );
  }
  return <ComingSoon title={section} />;
}

/* ---------------------------------------------------------------- modals */

function ShareScopeModal({ doc, onClose, onSaved }: { doc: Doc; onClose: () => void; onSaved: (visibility: Visibility) => void }) {
  const [visibility, setVisibility] = useState<Visibility>(doc.visibility);
  const [chapter, setChapter] = useState(doc.chapter || "");
  const [busy, setBusy] = useState(false);
  const ref = useModal(onClose);

  async function save() {
    setBusy(true);
    const res = await fetch(`/api/doc/${doc.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ visibility, chapter }),
    }).catch(() => null);
    setBusy(false);
    if (res?.ok) onSaved(visibility);
  }

  return (
    <div className="dash-modal-backdrop" onClick={onClose}>
      <div className="dash-modal" ref={ref} role="dialog" aria-modal="true" aria-label={`Share ${doc.name}`} onClick={(e) => e.stopPropagation()}>
        <h2>Share {doc.name}</h2>
        <p className="dash-muted" style={{ padding: 0, marginTop: 4 }}>Choose who can see this resource.</p>
        <div className="visibility-options" style={{ marginTop: 12 }}>
          {VISIBILITIES.map((v) => (
            <label key={v.id} className={`visibility-option${visibility === v.id ? " is-active" : ""}`}>
              <input type="radio" name="share-visibility" checked={visibility === v.id} onChange={() => setVisibility(v.id)} />
              <span className="visibility-label">{v.label}</span>
              <span className="visibility-hint">{v.hint}</span>
            </label>
          ))}
        </div>
        {visibility === "chapter" && (
          <label className="dash-field" style={{ marginTop: 10 }}><span>Chapter</span>
            <input value={chapter} onChange={(e) => setChapter(e.target.value)} placeholder="e.g. Toronto Central" maxLength={80} /></label>
        )}
        <div className="dash-modal-actions">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="cta" disabled={busy} onClick={save}>{busy ? "Saving..." : "Save sharing"}</button>
        </div>
      </div>
    </div>
  );
}

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
        <h2>Share {doc.name}</h2>
        <p className="dash-muted" style={{ padding: 0, marginTop: 4 }}>The link carries a signed token. It expires and cannot be edited.</p>
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
          }}>{copied ? "Copied" : "Copy link"}</button>
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
              <span>{d.name}</span>
              <span className="assign-add">Assign</span>
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
