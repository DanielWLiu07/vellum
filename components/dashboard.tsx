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

export function Dashboard() {
  const [role, setRole] = useState<Role>("student");
  const [docs, setDocs] = useState<Doc[]>([]);
  const [viewer, setViewer] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/docs", { cache: "no-store" }).catch(() => null);
    if (res?.ok) setDocs((await res.json()).docs);
  }, []);
  useEffect(() => void refresh(), [refresh]);

  const view = useCallback(async (docId: string, watermark = "") => {
    const res = await fetch("/api/share", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: docId, watermark, ttlMinutes: 15 }),
    });
    if (res.ok) setViewer((await res.json()).embedUrl);
  }, []);

  const onUpload = async (file: File) => {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.set("file", file);
      await fetch("/api/upload", { method: "POST", body: fd });
      await refresh();
    } finally {
      setUploading(false);
    }
  };

  const active = ROLES.find((r) => r.id === role)!;

  return (
    <div className="dash">
      <div className="role-switch" role="tablist" aria-label="Viewing as">
        <span className="role-switch-label">Viewing as</span>
        {ROLES.map((r) => (
          <button
            key={r.id}
            role="tab"
            aria-selected={role === r.id}
            className={role === r.id ? "role-chip is-active" : "role-chip"}
            onClick={() => { setRole(r.id); setViewer(null); }}
          >
            {r.label}
          </button>
        ))}
      </div>
      <p className="dash-sub" style={{ marginBottom: 24 }}>{active.blurb}</p>

      {role === "student" && <StudentView onView={view} />}
      {role === "trainer" && (
        <TrainerView docs={docs} onView={view} onUploadClick={() => fileRef.current?.click()} uploading={uploading} />
      )}
      {role === "advisor" && <AdvisorView docs={docs} onView={view} />}
      {role === "admin" && (
        <AdminView docs={docs} onView={view} onUploadClick={() => fileRef.current?.click()} uploading={uploading} />
      )}

      {viewer && (
        <div className="viewer-modal-backdrop" onClick={() => setViewer(null)}>
          <div className="viewer-modal" onClick={(e) => e.stopPropagation()}>
            <button className="viewer-close" onClick={() => setViewer(null)} aria-label="Close">✕</button>
            <iframe key={viewer} className="viewer-modal-frame" src={viewer} title="Lesson viewer" sandbox="allow-scripts allow-same-origin" />
          </div>
        </div>
      )}

      <input
        ref={fileRef}
        type="file"
        accept="application/pdf"
        hidden
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void onUpload(f); }}
      />
    </div>
  );
}

// ---- shared bits ----------------------------------------------------------

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, [string, string]> = {
    done: ["Done", "ok"],
    in_progress: ["In progress", "warn"],
    not_started: ["Not started", "muted"],
  };
  const [label, tone] = map[status] ?? [status, "muted"];
  return <span className={`badge badge-${tone}`}>{label}</span>;
}

function ProgressBar({ value }: { value: number }) {
  return (
    <div className="bar" aria-label={`${value}%`}>
      <div className="bar-fill" style={{ width: `${value}%` }} />
    </div>
  );
}

function LessonCard({ title, sub, badge, action }: { title: string; sub: string; badge?: React.ReactNode; action: React.ReactNode }) {
  return (
    <div className="lesson-card">
      <div className="lesson-icon" aria-hidden>▤</div>
      <div className="lesson-body">
        <p className="lesson-title">{title}</p>
        <p className="lesson-sub">{sub}</p>
      </div>
      <div className="lesson-end">
        {badge}
        {action}
      </div>
    </div>
  );
}

// ---- role views -----------------------------------------------------------

function StudentView({ onView }: { onView: (id: string) => void }) {
  const done = STUDENT_ASSIGNMENTS.filter((a) => a.status === "done").length;
  return (
    <section className="role-section">
      <div className="section-head">
        <h2>Assigned to you</h2>
        <span className="section-count">{done}/{STUDENT_ASSIGNMENTS.length} done</span>
      </div>
      <div className="lesson-grid">
        {STUDENT_ASSIGNMENTS.map((a) => (
          <LessonCard
            key={a.id}
            title={a.title}
            sub={`${a.kind === "quiz" ? "Quiz" : "Lesson"} · from ${a.from}${a.due ? ` · due ${a.due}` : ""}`}
            badge={<StatusBadge status={a.status} />}
            action={
              a.kind === "document" && a.docId ? (
                <button className="btn primary" onClick={() => onView(a.docId!)}>Open</button>
              ) : (
                <button className="btn">{a.status === "done" ? "Review" : "Start"}</button>
              )
            }
          />
        ))}
      </div>
    </section>
  );
}

function DocManager({ docs, onView, onUploadClick, uploading, heading }: {
  docs: Doc[]; onView: (id: string, wm?: string) => void; onUploadClick: () => void; uploading: boolean; heading: string;
}) {
  return (
    <section className="role-section">
      <div className="section-head">
        <h2>{heading}</h2>
        <button className="cta" disabled={uploading} onClick={onUploadClick}>{uploading ? "Uploading…" : "Upload PDF"}</button>
      </div>
      <div className="lesson-grid">
        {docs.map((d) => (
          <LessonCard
            key={d.id}
            title={d.name}
            sub={`${d.bundled ? "Sample" : "Uploaded"} · ${(d.sizeBytes / 1024).toFixed(0)} KB`}
            action={<button className="btn primary" onClick={() => onView(d.id)}>View</button>}
          />
        ))}
        {docs.length === 0 && <p className="dash-muted">No documents yet — upload one.</p>}
      </div>
    </section>
  );
}

function TrainerView({ docs, onView, onUploadClick, uploading }: { docs: Doc[]; onView: (id: string, wm?: string) => void; onUploadClick: () => void; uploading: boolean }) {
  return (
    <>
      <DocManager docs={docs} onView={onView} onUploadClick={onUploadClick} uploading={uploading} heading="My lessons" />
      <section className="role-section">
        <div className="section-head"><h2>My group</h2><span className="section-count">{TRAINER_ROSTER.length} members</span></div>
        <div className="table-card">
          {TRAINER_ROSTER.map((m) => (
            <div key={m.id} className="member-row">
              <div className="member-id">
                <span className="avatar">{m.name.split(" ").map((p) => p[0]).join("")}</span>
                <div><p className="member-name">{m.name}</p><p className="member-email">{m.email}</p></div>
              </div>
              <div className="member-progress">
                <ProgressBar value={Math.round((m.done / m.assigned) * 100)} />
                <span className="member-frac">{m.done}/{m.assigned}</span>
              </div>
              <button className="btn">Assign…</button>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

function AdvisorView({ docs, onView }: { docs: Doc[]; onView: (id: string, wm?: string) => void }) {
  return (
    <>
      <section className="role-section">
        <div className="section-head"><h2>My chapter — trainers</h2><span className="section-count">{ADVISOR_TRAINERS.length} trainers</span></div>
        <div className="table-card">
          {ADVISOR_TRAINERS.map((t) => (
            <div key={t.id} className="member-row">
              <div className="member-id">
                <span className="avatar">{t.name.split(" ").map((p) => p[0]).join("")}</span>
                <div><p className="member-name">{t.name}</p><p className="member-email">{t.members} members</p></div>
              </div>
              <div className="member-progress"><ProgressBar value={t.completion} /><span className="member-frac">{t.completion}%</span></div>
              <button className="btn">Manage</button>
            </div>
          ))}
        </div>
      </section>
      <DocManager docs={docs} onView={onView} onUploadClick={() => {}} uploading={false} heading="Chapter lessons" />
    </>
  );
}

function AdminView({ docs, onView, onUploadClick, uploading }: { docs: Doc[]; onView: (id: string, wm?: string) => void; onUploadClick: () => void; uploading: boolean }) {
  const [users, setUsers] = useState<AdminUser[]>(ADMIN_USERS);
  return (
    <>
      <div className="stat-grid">
        {ADMIN_STATS.map((s) => (
          <div key={s.label} className="stat-card"><p className="stat-value">{s.value}</p><p className="stat-label">{s.label}</p></div>
        ))}
      </div>
      <section className="role-section">
        <div className="section-head"><h2>All users</h2><span className="section-count">manage roles</span></div>
        <div className="table-card">
          {users.map((u) => (
            <div key={u.id} className="member-row">
              <div className="member-id">
                <span className="avatar">{u.name.split(" ").map((p) => p[0]).join("")}</span>
                <div><p className="member-name">{u.name}</p><p className="member-email">{u.email}</p></div>
              </div>
              <select
                className="role-select"
                value={u.role}
                onChange={(e) => setUsers((prev) => prev.map((x) => (x.id === u.id ? { ...x, role: e.target.value as Role } : x)))}
              >
                {ROLES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
              </select>
            </div>
          ))}
        </div>
      </section>
      <DocManager docs={docs} onView={onView} onUploadClick={onUploadClick} uploading={uploading} heading="All documents" />
    </>
  );
}
