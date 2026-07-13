"use client";

import Link from "next/link";

import { OFFICIAL_GUIDELINES } from "@/lib/official-guidelines";
import { useCallback, useEffect, useRef, useState } from "react";

import { DOC_SORTS, matchesQuery, sortDocs, type DocSort } from "@/lib/resource-list";

import { ActivityLog } from "./activity-log";
import { CardThumb } from "./card-thumb";
import { FavoriteButton } from "./favorite-button";
import { useFavorites } from "./favorites-context";
import { FlashcardsView } from "./flashcards-view";
import { MoveToFolder } from "./move-to-folder";
import { ShareDialog, type ShareTarget } from "./share-dialog";
import { useDecks } from "./use-decks";
import { useFolders } from "./use-folders";
import { QuizzesView } from "./quizzes-view";
import { SkillsView } from "./buzzer-game";
import { FeedbackView } from "./feedback-view";
import { ModulesLobby } from "./modules-lobby";
import { useModal } from "./use-modal";
import {
  DEMO_VIEWER,
  canEdit,
  canManageSharing,
  filterScoped,
  type FilterMode,
  type PersonShare,
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
  people: PersonShare[];
  thumbnailId?: string;
  contentType?: string;
  event?: string;
  noPreview?: boolean;
  official?: boolean;
  folderId?: string;
}

/**
 * A unified "resource" - either an uploaded document or a flashcard deck. Both
 * share visibility/owner/people so they filter, search, sort, and favorite the
 * same way in the Resources view. Doc-only fields (event/folder/official/
 * preview) are absent on decks; deck-only `cardCount` is absent on docs.
 */
interface ResItem {
  kind: "doc" | "deck";
  id: string;
  name: string; // doc name, or deck title normalized for search/sort
  owner: string;
  visibility: Visibility;
  chapter: string;
  people: PersonShare[];
  sizeBytes: number; // 0 for decks
  uploadedAt: number; // deck createdAt normalized for sort
  // doc-only
  event?: string;
  folderId?: string;
  official?: boolean;
  bundled?: boolean;
  thumbnailId?: string;
  contentType?: string;
  noPreview?: boolean;
  // deck-only
  cardCount?: number;
}

/** Whether a card can show an auto page-preview (PDF or image, not opted out). */
function isPreviewable(d: { contentType?: string; noPreview?: boolean }): boolean {
  return !d.noPreview && (d.contentType === "application/pdf" || (d.contentType?.startsWith("image/") ?? false));
}

const VIS_LABEL: Record<Visibility, string> = { public: "Public", chapter: "Chapter", private: "Private" };

type ResourceMode = FilterMode | "saved";
const FILTERS: { id: ResourceMode; label: string }[] = [
  { id: "accessible", label: "All resources" },
  { id: "mine", label: "My resources" },
  { id: "saved", label: "Saved" },
];

/** Search + sort strip shared by every document grid. Optionally shows an
 * event filter when a non-empty `events` list is provided. */
function DocToolbar({ q, setQ, sort, setSort, shown, total, events, event, setEvent }: {
  q: string; setQ: (v: string) => void;
  sort: DocSort; setSort: (v: DocSort) => void;
  shown: number; total: number;
  events?: string[];
  event?: string;
  setEvent?: (v: string) => void;
}) {
  return (
    <div className="resource-toolbar">
      <input
        className="search-input"
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search by name, member, or event"
        aria-label="Search resources"
      />
      {events && events.length > 0 && setEvent && (
        <select
          className="sort-select"
          value={event ?? ""}
          onChange={(e) => setEvent(e.target.value)}
          aria-label="Filter by event"
        >
          <option value="">All events</option>
          {events.map((ev) => (
            <option key={ev} value={ev}>{ev}</option>
          ))}
        </select>
      )}
      <select
        className="sort-select"
        value={sort}
        onChange={(e) => setSort(e.target.value as DocSort)}
        aria-label="Sort resources"
      >
        {DOC_SORTS.map((o) => (
          <option key={o.id} value={o.id}>{o.label}</option>
        ))}
      </select>
      <span className="toolbar-count">
        {shown === total ? `${total} total` : `${shown} of ${total}`}
      </span>
    </div>
  );
}

// Sections an advisor shares with students (they are a student too); anything
// else in the advisor menu is advisor-only and renders in AdvisorView.
const STUDENT_SECTIONS = new Set(["home", "assignments", "resources", "flashcards", "quizzes", "skills"]);

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

/* ---------------------------------------------------------------- main */

// `href` items render as real links (Upload / Guidelines pages) instead of
// section switches — first-class rows in the same list, same styling.
type NavItem = { id: string; label: string; soon?: boolean; href?: string };

// Every role gets these at the bottom of their section list. Guidelines is
// a real dashboard SECTION (Drive-style year folders — see GuidelinesView),
// not an external page, so it keeps the dashboard chrome.
const COMMON_LINKS: NavItem[] = [
  { id: "guidelines", label: "Guidelines" },
  { id: "feedback", label: "Feedback" },
  { id: "upload", label: "Upload", href: "/upload" },
];

// Left-nav sections per role. `soon` items are round-2 features (not built yet).
const NAV: Record<Role, NavItem[]> = {
  student: [
    { id: "home", label: "Home" },
    { id: "assignments", label: "My assignments" },
    { id: "modules", label: "Modules" },
    { id: "resources", label: "Resources" },
    { id: "quizzes", label: "Quizzes" },
    { id: "skills", label: "General skills" },
    ...COMMON_LINKS,
  ],
  trainer: [
    { id: "lessons", label: "My lessons" },
    { id: "group", label: "My group" },
    { id: "modules", label: "Modules" },
    { id: "flashcards", label: "Flashcards" },
    { id: "quizzes", label: "Quizzes" },
    { id: "skills", label: "General skills" },
    ...COMMON_LINKS,
  ],
  // An advisor is also a student (some students are advisors), so they get the
  // full student menu plus their advisor-only sections.
  advisor: [
    { id: "home", label: "Home" },
    { id: "assignments", label: "My assignments" },
    { id: "modules", label: "Modules" },
    { id: "resources", label: "Resources" },
    { id: "quizzes", label: "Quizzes" },
    { id: "trainers", label: "My trainers" },
    { id: "lessons", label: "Chapter lessons" },
    { id: "skills", label: "General skills" },
    ...COMMON_LINKS,
  ],
  admin: [
    { id: "overview", label: "Overview" },
    { id: "users", label: "Users & roles" },
    { id: "modules", label: "Modules" },
    { id: "content", label: "All content" },
    { id: "access", label: "Roles & access" },
    { id: "activity", label: "Activity log" },
    { id: "settings", label: "Settings" },
    ...COMMON_LINKS,
  ],
};

const ADMIN_SETTINGS = [
  { label: "Allow student uploads", desc: "Let students submit their own documents", on: false },
  { label: "Require watermark on shares", desc: "Force a per-user watermark on every shared link", on: true },
  { label: "Enable General skills (round 2)", desc: "Buzzer game live; skills in front of AI and more coming", on: true },
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

  // Preserve the operator's place: /view links carry a validated back-target
  // so the viewer's "Dashboard" link restores this exact role + section
  // (the deep-link effect above re-hydrates them).
  const viewQuery = `?back=${encodeURIComponent(`/dashboard?role=${role}&section=${section}`)}`;

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

  // Google-Docs "Make a copy": the clone lands in My resources, private.
  const onCopy = useCallback(async (doc: Doc) => {
    const res = await fetch(`/api/doc/${doc.id}/copy`, { method: "POST" }).catch(() => null);
    if (res?.ok) {
      const j = await res.json();
      await refresh();
      notify(`Created "${j.name}" in My resources (private)`);
    } else {
      notify("Couldn't copy the document.");
    }
  }, [refresh, notify]);

  const active = ROLES.find((r) => r.id === role)!;
  const shared = {
    docs, onView: view, onShare: setShareDoc, onShareScope: setShareScopeDoc, onDelete, onCopy, onUploadClick: pickFile,
    uploading, loading, loadError, onRetry, viewQuery,
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
            {NAV[role].map((item) =>
              item.href ? (
                <Link
                  key={item.id}
                  href={item.href}
                  className="dash-nav-item dash-nav-link"
                  data-testid={`nav-${item.id}`}
                >
                  <span className="dash-nav-label">{item.label}</span>
                </Link>
              ) : (
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
              ),
            )}
          </nav>
        </aside>

        <main className="dash-main">
          <p className="dash-sub" style={{ marginBottom: 20 }}>{active.blurb}</p>
          {section === "guidelines" && <GuidelinesView />}
          {/* Modules: the HOSA-authored official content, its own tab. Rendered
              here (all handlers in scope) so every role shares one view; admins
              get create/organize powers. */}
          {section === "modules" && <ModulesLobby admin={role === "admin"} />}
          {section === "feedback" && <FeedbackView admin={role === "admin"} />}
          {!["guidelines", "modules", "feedback"].includes(section) && role === "student" && <StudentView section={section} docs={docs} viewQuery={viewQuery} onStart={(t) => notify(`Opening "${t}" (demo)`)} uploading={uploading} onUploadClick={pickFile} onShareScope={setShareScopeDoc} onCopy={onCopy} onChanged={onRetry} />}
          {!["guidelines", "modules", "feedback"].includes(section) && role === "trainer" && <TrainerView section={section} {...shared} onAssign={setAssignTo} />}
          {!["guidelines", "modules", "feedback"].includes(section) && role === "advisor" && (STUDENT_SECTIONS.has(section)
            ? <StudentView section={section} docs={docs} viewQuery={viewQuery} onStart={(t) => notify(`Opening "${t}" (demo)`)} uploading={uploading} onUploadClick={pickFile} onShareScope={setShareScopeDoc} onCopy={onCopy} onChanged={onRetry} />
            : <AdvisorView section={section} {...shared} onManage={(n) => notify(`Managing ${n} (demo)`)} />)}
          {!["guidelines", "modules", "feedback"].includes(section) && role === "admin" && <AdminView section={section} {...shared} onRole={(n, r) => notify(`${n} → ${r}`)} />}
        </main>
      </div>

      {viewer && <ViewerModal src={viewer} onClose={() => setViewer(null)} />}

      {shareDoc && <ShareModal doc={shareDoc} onClose={() => setShareDoc(null)} onView={view} notify={notify} />}
      {shareScopeDoc && (
        <ShareDialog
          target={{
            kind: "doc",
            id: shareScopeDoc.id,
            name: shareScopeDoc.name,
            visibility: shareScopeDoc.visibility,
            chapter: shareScopeDoc.chapter,
            people: shareScopeDoc.people,
            owner: shareScopeDoc.owner,
          }}
          onClose={() => setShareScopeDoc(null)}
          onSaved={(m) => { setShareScopeDoc(null); notify(m); void refresh(); }}
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
/* ------------------------------------------------------------ guidelines */

/**
 * Official HOSA Canada event guidelines, browsed like a drive: one folder
 * tile per season, click in for the documents as tiles, breadcrumb back.
 * Data is the static manifest (lib/official-guidelines.ts) — external PDFs,
 * opened in a new tab; no bytes stored here. Community sharing rules stay
 * on /guidelines (linked below the grid).
 */
function GuidelinesView() {
  const [year, setYear] = useState<string | null>(null);

  if (year === null) {
    return (
      <section>
        <div className="section-head">
          <h2 className="section-title">Official event guidelines</h2>
        </div>
        <div className="tile-grid">
          {OFFICIAL_GUIDELINES.map((season) => (
            <button
              key={season.year}
              type="button"
              className="tile tile-folder"
              data-testid={`guidelines-year-${season.year}`}
              onClick={() => setYear(season.year)}
            >
              <div className="tile-thumb">
                <div className="tile-preview folder" aria-hidden>
                  <span className="folder-tab" />
                </div>
              </div>
              <div className="tile-info">
                <p className="tile-title">{season.year}</p>
                <p className="tile-sub">{season.items.length} documents</p>
              </div>
            </button>
          ))}
        </div>
        <p className="dash-sub" style={{ marginTop: 18 }}>
          Looking for what you can share on Vitals? Read the{" "}
          <Link href="/guidelines">content &amp; sharing guidelines</Link>.
        </p>
      </section>
    );
  }

  const season = OFFICIAL_GUIDELINES.find((sn) => sn.year === year);
  return (
    <section>
      <div className="section-head">
        <button type="button" className="ghost" onClick={() => setYear(null)}>
          &larr; All years
        </button>
        <h2 className="section-title">{year} guidelines</h2>
      </div>
      <div className="tile-grid">
        {(season?.items ?? []).map((g) => (
          <a
            key={g.url}
            className="tile"
            href={g.url}
            target="_blank"
            rel="noreferrer noopener"
          >
            <div className="tile-thumb">
              <div className="tile-preview" aria-hidden>
                <span className="tile-line" />
                <span className="tile-line" />
                <span className="tile-line short" />
              </div>
              {g.archived && <span className="tile-badge">Archived copy</span>}
            </div>
            <div className="tile-info">
              <p className="tile-title">{g.title}</p>
              <p className="tile-sub">PDF &middot; opens in a new tab</p>
            </div>
          </a>
        ))}
      </div>
    </section>
  );
}

function LessonCard({ title, sub, badge, actions, thumbId, favorite, previewId, previewable }: { title: string; sub: string; badge?: React.ReactNode; actions: React.ReactNode; thumbId?: string; favorite?: React.ReactNode; previewId?: string; previewable?: boolean }) {
  return (
    <div className="tile">
      <CardThumb cover={thumbId} previewId={previewId} previewable={previewable} badge={badge} favorite={favorite} />
      <div className="tile-info"><p className="tile-title">{title}</p><p className="tile-sub">{sub}</p></div>
      <div className="tile-actions">{actions}</div>
    </div>
  );
}

type SharedProps = {
  docs: Doc[];
  onView: (id: string, wm?: string) => void;
  viewQuery: string;
  onShare: (d: Doc) => void;
  onShareScope: (d: Doc) => void;
  onDelete: (d: Doc) => void;
  onCopy: (d: Doc) => void;
  onUploadClick: () => void;
  uploading: boolean;
  loading: boolean;
  loadError: boolean;
  onRetry: () => void;
};

function DocManager({ docs, viewQuery, onShare, onShareScope, onDelete, onCopy, onUploadClick, uploading, loading, loadError, onRetry, heading, canUpload = true, admin = false }: Omit<SharedProps, "onView"> & { heading: string; canUpload?: boolean; admin?: boolean }) {
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<DocSort>("newest");
  const { countOf } = useFavorites();
  const { folders, create: createFolder, rename: renameFolder, remove: removeFolder } = useFolders();
  const visible = sortDocs(docs.filter((d) => matchesQuery(d, q)), sort, countOf);
  const officialFolders = folders.filter((f) => f.official);

  // Admin: promote/demote a resource to official (HOSA-created, locked).
  async function toggleOfficial(d: Doc) {
    const res = await fetch(`/api/doc/${d.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ official: !d.official }),
    }).catch(() => null);
    if (res?.ok) onRetry();
  }

  return (
    <section className="role-section">
      <div className="section-head">
        <h2>{heading}</h2>
        <div style={{ display: "flex", gap: 8 }}>
          {admin && (
            <button
              className="btn"
              onClick={async () => {
                const name = window.prompt("New module name");
                if (name && name.trim()) await createFolder(name.trim(), true);
              }}
            >
              + New module
            </button>
          )}
          {canUpload && <button className="cta" disabled={uploading} onClick={onUploadClick}>{uploading ? "Uploading..." : "+ Upload PDF"}</button>}
        </div>
      </div>
      {admin && officialFolders.length > 0 && (
        <div className="folder-manage-list" role="group" aria-label="Modules">
          {officialFolders.map((f) => (
            <span key={f.id} className="folder-manage-item">
              <span className="folder-manage-name">{f.name}</span>
              <button
                type="button"
                className="link-btn"
                onClick={async () => {
                  const name = window.prompt("Rename module", f.name);
                  if (name && name.trim() && name.trim() !== f.name) await renameFolder(f.id, name.trim());
                }}
              >
                Rename
              </button>
              <button
                type="button"
                className="link-btn link-danger"
                onClick={async () => {
                  if (!window.confirm(`Delete the module "${f.name}"? Its resources stay, but become unfiled.`)) return;
                  await removeFolder(f.id);
                }}
              >
                Delete
              </button>
            </span>
          ))}
        </div>
      )}
      {!loading && !loadError && docs.length > 0 && (
        <DocToolbar q={q} setQ={setQ} sort={sort} setSort={setSort} shown={visible.length} total={docs.length} />
      )}
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
          visible.length === 0 ? (
            <div className="empty-state">No documents match.</div>
          ) : (
          visible.map((d) => (
            <LessonCard key={d.id} title={d.name} sub={`${d.bundled ? "Sample" : "Uploaded"} · ${(d.sizeBytes / 1024).toFixed(0)} KB`}
              previewId={d.id} previewable={isPreviewable(d)}
              favorite={<FavoriteButton id={d.id} label={d.name} />}
              actions={<>
                <Link className="btn primary" href={`/view/${d.id}${viewQuery}`}>View</Link>
                {!d.bundled && canManageSharing(d, DEMO_VIEWER) && <button className="btn" onClick={() => onShareScope(d)}>Share</button>}
                <button className="btn" onClick={() => onShare(d)}>Get link</button>
                <button className="btn" onClick={() => onCopy(d)}>Make a copy</button>
                {admin && !d.bundled && (
                  <button className={`btn${d.official ? " danger" : ""}`} onClick={() => void toggleOfficial(d)}>
                    {d.official ? "Remove from modules" : "Add to modules"}
                  </button>
                )}
                {admin && d.official && officialFolders.length > 0 && (
                  <MoveToFolder docId={d.id} current={d.folderId} folders={officialFolders} onMoved={onRetry} />
                )}
                {!d.bundled && d.owner === DEMO_VIEWER.owner && <button className="btn danger" onClick={() => onDelete(d)}>Delete</button>}
              </>} />
          ))
          )
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

function StudentView({ section, docs, viewQuery, onStart, uploading, onUploadClick, onShareScope, onCopy, onChanged }: { section: string; docs: Doc[]; viewQuery: string; onStart: (title: string) => void; uploading: boolean; onUploadClick: () => void; onShareScope: (d: Doc) => void; onCopy: (d: Doc) => void; onChanged: () => void }) {
  const done = STUDENT_ASSIGNMENTS.filter((a) => a.status === "done").length;
  const total = STUDENT_ASSIGNMENTS.length;
  const pct = Math.round((done / total) * 100);
  const next = STUDENT_ASSIGNMENTS.find((a) => a.status !== "done");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<DocSort>("newest");
  const [mode, setMode] = useState<ResourceMode>("accessible");
  const [event, setEvent] = useState("");
  const [folderId, setFolderId] = useState<string | null>(null);
  const { favorites, countOf } = useFavorites();
  const { folders, create: createFolder, rename: renameFolder, remove: removeFolder } = useFolders();
  // Flashcard decks are resources too: they show in this grid alongside docs.
  const { decks, copy: copyDeck, del: delDeck, load: reloadDecks, busyId: deckBusy } = useDecks();
  const [deckShare, setDeckShare] = useState<ShareTarget | null>(null);

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
              {next.kind === "document" && next.docId ? (
                <Link className="btn primary" href={`/view/${next.docId}${viewQuery}`}>
                  {next.status === "in_progress" ? "Continue" : "Start"}
                </Link>
              ) : (
                <button className="btn primary" onClick={() => onStart(next.title)}>
                  {next.status === "in_progress" ? "Continue" : "Start"}
                </button>
              )}
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
                ? <Link className="btn primary" href={`/view/${a.docId}${viewQuery}`}>Open</Link>
                : <button className="btn primary" onClick={() => onStart(a.title)}>{a.status === "done" ? "Review" : "Start"}</button>} />
          ))}
        </div>
      </section>
    );
  }

  if (section === "resources") {
    // Unified resources: uploaded documents + flashcard decks. Official content
    // (HOSA-authored "Modules") is excluded here - it lives in its own Modules
    // tab, so Resources is just the shared/community pool.
    const items: ResItem[] = [
      ...docs.filter((d) => !d.official).map((d) => ({ kind: "doc" as const, ...d })),
      ...decks.map((k) => ({
        kind: "deck" as const,
        id: k.id, name: k.title, owner: k.owner, visibility: k.visibility,
        chapter: k.chapter, people: k.people, cardCount: k.cardCount,
        uploadedAt: k.createdAt, sizeBytes: 0,
      })),
    ];
    // Recover the original Doc for the doc-specific share/copy handlers.
    const docFromItem = (d: ResItem): Doc => docs.find((x) => x.id === d.id)!;
    const accessible = filterScoped(items, DEMO_VIEWER, "accessible");
    const counts: Record<ResourceMode, number> = {
      accessible: accessible.length,
      mine: filterScoped(items, DEMO_VIEWER, "mine").length,
      saved: accessible.filter((d) => favorites.has(d.id)).length,
      public: 0,
      chapter: 0,
    };
    const scoped = mode === "saved"
      ? accessible.filter((d) => favorites.has(d.id))
      : filterScoped(items, DEMO_VIEWER, mode);
    // Event options come from the CURRENT scope (not all accessible docs), so
    // the dropdown never offers a category that isn't in the active tab.
    const eventList = [...new Set(scoped.map((d) => d.event).filter((e): e is string => !!e))]
      .sort((a, b) => a.localeCompare(b));
    // Folders shown in the bar: those with at least one resource in the current
    // scope. Personal folders you can file INTO come from `myFolders`.
    const foldersInScope = folders.filter((f) => scoped.some((d) => d.folderId === f.id));
    const myFolders = folders.filter((f) => !f.official);
    const filtered = scoped.filter(
      (d) => (!event || d.event === event) && (!folderId || d.folderId === folderId) && matchesQuery(d, q),
    );
    const visible = sortDocs(filtered, sort, countOf);
    const noFilters = !q.trim() && !event && !folderId;
    const mineEmpty = mode === "mine" && visible.length === 0 && noFilters;
    const savedEmpty = mode === "saved" && visible.length === 0 && noFilters;
    return (
      <section className="role-section">
        <div className="section-head">
          <h2>Resources</h2>
          <div style={{ display: "flex", gap: 8 }}>
            <Link className="btn" href="/upload?type=flashcards">+ New flashcards</Link>
            <button className="cta" disabled={uploading} onClick={onUploadClick}>
              {uploading ? "Uploading..." : "+ Upload a resource"}
            </button>
          </div>
        </div>
        <div className="seg-toggle" role="tablist" aria-label="Resource scope">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              role="tab"
              aria-selected={mode === f.id}
              className={`seg-btn${mode === f.id ? " is-active" : ""}`}
              onClick={() => { setMode(f.id); setEvent(""); setFolderId(null); setQ(""); }}
            >
              {f.label} <span className="seg-count">{counts[f.id]}</span>
            </button>
          ))}
        </div>
        <p className="dash-sub" style={{ marginTop: 10, marginBottom: 12 }}>
          {mode === "mine"
            ? "Files you uploaded. They start private; use Share to let your chapter or everyone see them."
            : mode === "saved"
              ? "Resources you saved. Tap the heart on any resource to add it here."
              : `Everything shared with you, viewing as a member of ${DEMO_VIEWER.chapter}.`}
        </p>
        <div className="folder-bar" role="tablist" aria-label="Folders">
          <button
            type="button"
            className={`folder-chip${!folderId ? " is-active" : ""}`}
            onClick={() => setFolderId(null)}
          >
            All resources
          </button>
          {foldersInScope.map((f) => (
            <button
              key={f.id}
              type="button"
              className={`folder-chip${folderId === f.id ? " is-active" : ""}${f.official ? " is-official" : ""}`}
              onClick={() => setFolderId(f.id)}
            >
              {f.name}
              <span className="folder-count">{scoped.filter((d) => d.folderId === f.id).length}</span>
            </button>
          ))}
          <button
            type="button"
            className="folder-chip folder-new"
            onClick={async () => {
              const name = window.prompt("New folder name");
              if (name && name.trim()) await createFolder(name.trim());
            }}
          >
            + New folder
          </button>
        </div>
        {(() => {
          // Manage controls for the selected folder. Only personal (non-official)
          // folders are shown here, and the API returns only the viewer's own, so
          // any non-official folder in scope is theirs to rename or delete.
          const active = folderId ? foldersInScope.find((f) => f.id === folderId) : null;
          if (!active || active.official) return null;
          return (
            <div className="folder-manage" role="group" aria-label={`Manage folder ${active.name}`}>
              <button
                type="button"
                className="link-btn"
                onClick={async () => {
                  const name = window.prompt("Rename folder", active.name);
                  if (name && name.trim() && name.trim() !== active.name) await renameFolder(active.id, name.trim());
                }}
              >
                Rename folder
              </button>
              <button
                type="button"
                className="link-btn link-danger"
                onClick={async () => {
                  if (!window.confirm(`Delete the folder "${active.name}"? Its resources stay, but become unfiled.`)) return;
                  const ok = await removeFolder(active.id);
                  if (ok) setFolderId(null);
                }}
              >
                Delete folder
              </button>
            </div>
          );
        })()}
        <DocToolbar q={q} setQ={setQ} sort={sort} setSort={setSort} shown={visible.length} total={scoped.length}
          events={eventList} event={event} setEvent={setEvent} />
        <div className="tile-grid">
          {visible.map((d) => d.kind === "deck" ? (
            <LessonCard key={d.id} title={d.name} previewable={false}
              favorite={<FavoriteButton id={d.id} label={d.name} />}
              badge={<span className={`badge badge-${d.visibility === "public" ? "ok" : d.visibility === "chapter" ? "warn" : "muted"}`}>{VIS_LABEL[d.visibility]}</span>}
              sub={`Flashcards · ${d.cardCount} card${d.cardCount === 1 ? "" : "s"}${d.owner === DEMO_VIEWER.owner ? " · Yours" : d.owner === "system" ? " · HOSA sample" : ` · By ${d.owner}`}${d.people.length > 0 ? ` · shared with ${d.people.length}` : ""}`}
              actions={
                <>
                  <Link className="btn primary" href={`/decks/${d.id}`}>Study</Link>
                  {d.id !== "sample-deck" && canEdit(d, DEMO_VIEWER) && <Link className="btn" href={`/decks/${d.id}/edit`}>Edit</Link>}
                  <button className="btn" disabled={deckBusy === d.id} onClick={() => void copyDeck(d.id)}>Make a copy</button>
                  {d.id !== "sample-deck" && canManageSharing(d, DEMO_VIEWER) && (
                    <button className="btn" onClick={() => setDeckShare({ kind: "deck", id: d.id, name: d.name, visibility: d.visibility, chapter: d.chapter, people: d.people, owner: d.owner })}>Share</button>
                  )}
                  {d.owner === DEMO_VIEWER.owner && <button className="btn danger" disabled={deckBusy === d.id} onClick={() => void delDeck(d.id)}>Delete</button>}
                </>
              } />
          ) : (
            <LessonCard key={d.id} title={d.name} thumbId={d.thumbnailId}
              previewId={d.id} previewable={isPreviewable(d)}
              favorite={<FavoriteButton id={d.id} label={d.name} />}
              badge={d.official
                ? <span className="badge badge-official">Official</span>
                : <span className={`badge badge-${d.visibility === "public" ? "ok" : d.visibility === "chapter" ? "warn" : "muted"}`}>{VIS_LABEL[d.visibility]}</span>}
              sub={`${d.official || d.bundled ? "HOSA official" : d.owner === DEMO_VIEWER.owner ? "Your upload" : "Shared by a member"}${d.event ? ` · ${d.event}` : ""}${d.visibility === "chapter" && d.chapter ? ` · ${d.chapter}` : ""}${d.people.length > 0 ? ` · shared with ${d.people.length}` : ""}`}
              actions={
                <>
                  <Link className="btn primary" href={`/view/${d.id}${viewQuery}`}>Open</Link>
                  {!d.bundled && canManageSharing(d, DEMO_VIEWER) && <button className="btn" onClick={() => onShareScope(docFromItem(d))}>Share</button>}
                  <button className="btn" onClick={() => onCopy(docFromItem(d))}>Make a copy</button>
                  {!d.official && d.owner === DEMO_VIEWER.owner && myFolders.length > 0 && (
                    <MoveToFolder docId={d.id} current={d.folderId} folders={myFolders} onMoved={onChanged} />
                  )}
                </>
              } />
          ))}
          {savedEmpty
            ? <div className="empty-state">No saved resources yet. Tap the heart on any resource to save it here.</div>
            : mineEmpty
            ? <div className="empty-state">Nothing of yours yet. Upload a document or create flashcards to get started.</div>
            : visible.length === 0 && <div className="empty-state">No resources match.</div>}
        </div>
        {deckShare && (
          <ShareDialog
            target={deckShare}
            onClose={() => setDeckShare(null)}
            onSaved={() => { setDeckShare(null); void reloadDecks(); }}
          />
        )}
      </section>
    );
  }

  if (section === "flashcards") return <FlashcardsView />;
  if (section === "quizzes") return <QuizzesView />;
  if (section === "skills") return <SkillsView />;

  return <ComingSoon title={section} />;
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
  if (section === "skills") return <SkillsView />;

  return <ComingSoon title={section} />;
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
  if (section === "content") return <DocManager {...shared} heading="All content" admin />;
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
