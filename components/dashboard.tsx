"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";

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
import { AssignModal } from "./assign-modal";
import { ChapterView } from "./chapter-view";
import {
  completeAssignment,
  formatDue,
  KIND_LABEL,
  refHref,
  useAssignments,
  useMe,
  type Assignment,
  type RosterMember,
} from "./use-assignments";
import { initials } from "@/lib/avatar";
import { DashSidebar } from "@/components/dash-sidebar";
import { OfficialGuidelinesView } from "@/components/official-guidelines-view";
import { DEFAULT_SECTION, roleFromParam, sectionFromParam } from "@/lib/nav";
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
  CHAPTER,
  ROLES,
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

// Sections every role sees the same way, rendered once above the role views.
const SHARED_SECTIONS = ["guidelines", "modules", "feedback", "chapter"];

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

/**
 * Mirror the active view into ?role=&section= so the dashboard chrome (left
 * sidebar included) survives a reload, a back button, or a link straight to a
 * section — /dashboard?section=guidelines is how the guidelines browser is
 * reached now. history.replaceState instead of router.replace: switching a
 * client-side view shouldn't cost an RSC round-trip, and Next wires
 * replaceState into useSearchParams for us.
 */
function syncUrl(role: Role, section: string) {
  const p = new URLSearchParams(window.location.search);
  p.set("role", role);
  p.set("section", section);
  window.history.replaceState(null, "", `${window.location.pathname}?${p}`);
}

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
  // Deep-link support: ?role= and ?section= each work on their own, so
  // /dashboard?section=guidelines opens the guidelines browser with the sidebar
  // intact. Resolved during render (not in an effect) so the first paint is
  // already the requested section instead of flashing the default one.
  const searchParams = useSearchParams();
  const roleParam = searchParams.get("role");
  const sectionParam = searchParams.get("section");
  const urlRole = roleFromParam(roleParam);
  const urlSection = sectionFromParam(urlRole, sectionParam);

  const [role, setRole] = useState<Role>(urlRole);
  const [section, setSection] = useState<string>(urlSection);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [viewer, setViewer] = useState<string | null>(null);
  const [shareDoc, setShareDoc] = useState<Doc | null>(null);
  const [shareScopeDoc, setShareScopeDoc] = useState<Doc | null>(null);
  const [assignTo, setAssignTo] = useState<RosterMember | null>(null);
  // Bumped after an assign/unassign so the roster's completion counts refetch.
  const [assignmentsVersion, setAssignmentsVersion] = useState(0);
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

  // Follow later param changes too: the topnav "Guidelines" link points at this
  // same route, and that navigation re-renders without remounting, so the
  // initial state above would otherwise be stale.
  useEffect(() => {
    if (!roleParam && !sectionParam) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    setRole(urlRole);
    setSection(urlSection);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [roleParam, sectionParam, urlRole, urlSection]);

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
        <DashSidebar
          role={role}
          active={section}
          onRole={(r) => {
            setRole(r);
            setSection(DEFAULT_SECTION[r]);
            setViewer(null);
            syncUrl(r, DEFAULT_SECTION[r]);
          }}
          onSection={(id) => { setSection(id); syncUrl(role, id); }}
        />

        <main className="dash-main">
          <p className="dash-sub" style={{ marginBottom: 20 }}>{active.blurb}</p>
          {section === "guidelines" && <OfficialGuidelinesView />}
          {/* Modules: the HOSA-authored official content, its own tab. Rendered
              here (all handlers in scope) so every role shares one view; admins
              get create/organize powers. */}
          {section === "modules" && <ModulesLobby admin={role === "admin"} />}
          {section === "feedback" && <FeedbackView admin={role === "admin"} />}
          {section === "chapter" && <ChapterView refreshToken={assignmentsVersion} onAssign={setAssignTo} />}
          {!SHARED_SECTIONS.includes(section) && role === "student" && <StudentView section={section} docs={docs} viewQuery={viewQuery} notify={notify} uploading={uploading} onUploadClick={pickFile} onShareScope={setShareScopeDoc} onCopy={onCopy} onChanged={onRetry} />}
          {!SHARED_SECTIONS.includes(section) && role === "trainer" && <TrainerView section={section} {...shared} />}
          {!SHARED_SECTIONS.includes(section) && role === "advisor" && (STUDENT_SECTIONS.has(section)
            ? <StudentView section={section} docs={docs} viewQuery={viewQuery} notify={notify} uploading={uploading} onUploadClick={pickFile} onShareScope={setShareScopeDoc} onCopy={onCopy} onChanged={onRetry} />
            : <AdvisorView section={section} {...shared} />)}
          {!SHARED_SECTIONS.includes(section) && role === "admin" && <AdminView section={section} {...shared} onRole={(n, r) => notify(`${n} → ${r}`)} />}
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
          member={assignTo}
          docs={docs.map((d) => ({ id: d.id, name: d.name }))}
          onClose={() => setAssignTo(null)}
          onChanged={() => setAssignmentsVersion((v) => v + 1)}
          notify={notify}
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

function StudentView({ section, docs, viewQuery, notify, uploading, onUploadClick, onShareScope, onCopy, onChanged }: { section: string; docs: Doc[]; viewQuery: string; notify: (msg: string) => void; uploading: boolean; onUploadClick: () => void; onShareScope: (d: Doc) => void; onCopy: (d: Doc) => void; onChanged: () => void }) {
  // Real assignments for whoever is actually signed in. Asking by id (rather
  // than trusting the previewed role) means a trainer previewing "student" sees
  // their OWN queue, not their whole chapter's.
  const me = useMe();
  const { assignments, loading: loadingAssignments, error: assignmentsError, reload: reloadAssignments } =
    useAssignments(me?.id, !!me);
  const [busyId, setBusyId] = useState<string | null>(null);
  const done = assignments.filter((a) => a.status === "done").length;
  const total = assignments.length;
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  // Soonest due first, undated last — "what should I do next", not "what's newest".
  const next = assignments
    .filter((a) => a.status !== "done")
    .sort((a, b) => (a.dueAt ?? Infinity) - (b.dueAt ?? Infinity))[0];

  async function markDone(a: Assignment) {
    setBusyId(a.id);
    const res = await completeAssignment(a.id, a.title);
    setBusyId(null);
    notify(res.message);
    if (res.ok) await reloadAssignments();
  }
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
              <p className="lesson-sub">
                Up next{formatDue(next.dueAt) ? ` · due ${formatDue(next.dueAt)}` : ""}
              </p>
              <p className="lesson-title">{next.title}</p>
            </div>
            <div className="lesson-end">
              <Link className="btn primary" href={refHref(next.kind, next.refId, viewQuery)}>Start</Link>
            </div>
          </div>
        )}
      </>
    );
  }

  if (section === "assignments") {
    return (
      <section className="role-section">
        <div className="section-head">
          <h2>Assigned to you</h2>
          <span className="section-count">
            {loadingAssignments ? "loading..." : `${done} of ${total} complete`}
          </span>
        </div>
        {total > 0 && <div className="progress-banner"><ProgressBar value={pct} /><span>{pct}%</span></div>}
        <div className="tile-grid">
          {assignmentsError ? (
            <div className="empty-state">{assignmentsError}</div>
          ) : loadingAssignments ? (
            <div className="empty-state">Loading your assignments...</div>
          ) : total === 0 ? (
            <div className="empty-state">No assignments yet. Your trainer or advisor assigns work here.</div>
          ) : (
            assignments.map((a) => (
              <LessonCard key={a.id} title={a.title}
                sub={`${KIND_LABEL[a.kind]} · from ${a.assignedByName}${formatDue(a.dueAt) ? ` · due ${formatDue(a.dueAt)}` : ""}`}
                badge={<StatusBadge status={a.status === "done" ? "done" : "not_started"} />}
                actions={<>
                  <Link className="btn primary" href={refHref(a.kind, a.refId, viewQuery)}>Open</Link>
                  {a.status !== "done" && (
                    <button className="btn" disabled={busyId === a.id} onClick={() => void markDone(a)}>
                      {busyId === a.id ? "Saving..." : "Mark done"}
                    </button>
                  )}
                </>} />
            ))
          )}
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
                  <Link className="btn primary" href={`/decks/${d.id}${viewQuery}`}>Study</Link>
                  {d.id !== "sample-deck" && canEdit(d, DEMO_VIEWER) && <Link className="btn" href={`/decks/${d.id}/edit${viewQuery}`}>Edit</Link>}
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

function TrainerView({ section, ...shared }: SharedProps & { section: string }) {
  if (section === "lessons") return <DocManager {...shared} docs={filterScoped(shared.docs, DEMO_VIEWER, "accessible")} heading="My lessons" />;
  if (section === "flashcards") return <FlashcardsView />;
  if (section === "quizzes") return <QuizzesView />;
  if (section === "skills") return <SkillsView />;

  return <ComingSoon title={section} />;
}

function AdvisorView({ section, ...shared }: SharedProps & { section: string }) {
  if (section === "lessons") return <DocManager {...shared} docs={filterScoped(shared.docs, DEMO_VIEWER, "accessible")} heading="Chapter lessons" />;
  return <ComingSoon title={section} />;
}

// People and assigning live in "My chapter" now (one surface for every role);
// "Users & roles" below stays a demo fixture, since nothing serves role changes.
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

