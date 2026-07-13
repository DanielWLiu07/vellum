"use client";

import Link from "next/link";
import * as React from "react";

import { ModulePlayer } from "./module-player";
import { useAutosave, type SaveStatus } from "./use-autosave";

type EditorKind = "google" | "pdf" | "info";
type Subsection = { id: string; title: string; kind: EditorKind; slides: string; docId: string; docName: string; body: string };
type Section = { id: string; title: string; subsections: Subsection[] };

const uid = (p: string) => `${p}_${crypto.randomUUID().slice(0, 8)}`;
const blankSub = (): Subsection => ({ id: uid("ss"), title: "", kind: "google", slides: "", docId: "", docName: "", body: "" });
const blankSection = (): Section => ({ id: uid("sec"), title: "", subsections: [blankSub()] });

// Reconstruct an editable Google link from a stored id so the field round-trips.
const linkFor = (ss: { slidesId?: string; kind?: string; slidesPub?: boolean }) => {
  if (!ss.slidesId) return "";
  const type = ss.kind === "doc" ? "document" : "presentation";
  return `https://docs.google.com/${type}/d/${ss.slidesPub ? "e/" : ""}${ss.slidesId}/edit`;
};

const KINDS: { id: EditorKind; label: string }[] = [
  { id: "google", label: "Google Slides / Docs" },
  { id: "pdf", label: "PDF upload" },
  { id: "info", label: "Written info" },
];

/** Admin editor for a learning module. Each subsection picks a content type:
 * a Google Slides/Docs link, an uploaded PDF, or written info. Live-autosaved. */
export function ModuleEditor({ moduleId }: { moduleId: string }) {
  const [title, setTitle] = React.useState("");
  const [summary, setSummary] = React.useState("");
  const [sections, setSections] = React.useState<Section[]>([blankSection()]);
  const [state, setState] = React.useState<"loading" | "ready" | "denied">("loading");
  const [error, setError] = React.useState<string | null>(null);
  const [uploadingId, setUploadingId] = React.useState<string | null>(null);
  // Bumped after each successful save so the live preview (the real student
  // player) re-fetches and shows the just-saved state.
  const [previewVersion, setPreviewVersion] = React.useState(0);
  const saveAbort = React.useRef<AbortController | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch(`/api/modules/${moduleId}`, { cache: "no-store" }).catch(() => null);
      const j = res?.ok ? await res.json().catch(() => null) : null;
      if (cancelled) return;
      if (!j?.module || !j.canEdit) { setState("denied"); return; }
      setTitle(j.module.title ?? "");
      setSummary(j.module.summary ?? "");
      const loaded: Section[] = (j.module.sections ?? []).map((s: { id?: string; title?: string; subsections?: unknown[] }) => ({
        id: s.id ?? uid("sec"),
        title: s.title ?? "",
        subsections: ((s.subsections?.length ? s.subsections : [{}]) as { id?: string; title?: string; kind?: string; slidesId?: string; slidesPub?: boolean; docId?: string; body?: string }[]).map((ss) => ({
          id: ss.id ?? uid("ss"),
          title: ss.title ?? "",
          kind: ss.kind === "pdf" ? "pdf" : ss.kind === "info" ? "info" : "google",
          slides: linkFor(ss),
          docId: ss.docId ?? "",
          docName: ss.docId ? "Attached PDF" : "",
          body: ss.body ?? "",
        })),
      }));
      setSections(loaded.length ? loaded : [blankSection()]);
      setState("ready");
    })();
    return () => { cancelled = true; };
  }, [moduleId]);

  async function autosaveNow(): Promise<boolean> {
    saveAbort.current?.abort();
    const ctrl = new AbortController();
    saveAbort.current = ctrl;
    try {
      const res = await fetch(`/api/modules/${moduleId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, summary, sections }),
        signal: ctrl.signal,
        keepalive: true,
      });
      if (res.ok) { setError(null); setPreviewVersion((v) => v + 1); return true; }
      const j = await res.json().catch(() => null);
      setError(
        j?.error === "content_flagged"
          ? `Content moderation flagged this module${Array.isArray(j.categories) && j.categories.length ? ` (${j.categories.join(", ")})` : ""}. Fix it to keep saving.`
          : "Couldn't save your changes.",
      );
      return false;
    } catch (e) {
      if ((e as Error)?.name === "AbortError") return true;
      setError("Couldn't save your changes.");
      return false;
    }
  }
  const status = useAutosave(autosaveNow, JSON.stringify({ title, summary, sections }), { enabled: state === "ready" });

  const patchSection = (si: number, p: Partial<Section>) => setSections((xs) => xs.map((s, i) => (i === si ? { ...s, ...p } : s)));
  const patchSub = (si: number, sj: number, p: Partial<Subsection>) =>
    patchSection(si, { subsections: sections[si]!.subsections.map((ss, j) => (j === sj ? { ...ss, ...p } : ss)) });
  const addSection = () => setSections((xs) => [...xs, blankSection()]);
  const removeSection = (si: number) => setSections((xs) => (xs.length > 1 ? xs.filter((_, i) => i !== si) : xs));
  const addSub = (si: number) => patchSection(si, { subsections: [...sections[si]!.subsections, blankSub()] });
  const removeSub = (si: number, sj: number) => {
    const s = sections[si]!;
    if (s.subsections.length <= 1) return;
    patchSection(si, { subsections: s.subsections.filter((_, j) => j !== sj) });
  };

  async function uploadPdf(si: number, sj: number, sub: Subsection, file: File | undefined) {
    if (!file) return;
    setUploadingId(sub.id);
    try {
      const fd = new FormData();
      fd.set("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: fd }).catch(() => null);
      const j = res?.ok ? await res.json().catch(() => null) : null;
      if (j?.id) patchSub(si, sj, { docId: j.id, docName: j.name ?? file.name });
      else setError(res?.status === 415 ? "That wasn't a PDF - upload a .pdf file." : "Couldn't upload that PDF.");
    } finally {
      setUploadingId(null);
    }
  }

  if (state === "loading") return <div className="upload-card"><p className="dash-sub">Loading the module...</p></div>;
  if (state === "denied") {
    return (
      <div className="upload-card">
        <h1 className="upload-h">Can&apos;t edit this module</h1>
        <p className="dash-sub">It doesn&apos;t exist, or you&apos;re not an admin. Modules are authored by HOSA staff.</p>
        <Link className="btn" href="/dashboard?section=modules">Back to modules</Link>
      </div>
    );
  }

  return (
    <div className="mod-editor-split">
      <form className="upload-card mod-editor-form" onSubmit={(e) => e.preventDefault()}>
      <div className="editor-head">
        <h1 className="upload-h">Edit module</h1>
        <SaveStatusChip status={status} />
      </div>
      <p className="dash-sub">
        Sections hold subsections. Each subsection is one of: a Google Slides/Docs link, an uploaded PDF, or written info.
        Changes save automatically.
      </p>

      <label className="dash-field"><span>Module title</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. EMT Fundamentals" maxLength={120} /></label>
      <label className="dash-field"><span>Summary (optional)</span>
        <input value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="One line describing the module" maxLength={240} /></label>

      <div className="mod-edit-sections">
        {sections.map((sec, si) => (
          <div key={sec.id} className="mod-edit-section">
            <div className="mod-edit-section-head">
              <span className="mod-edit-section-num">Section {si + 1}</span>
              <button type="button" className="card-edit-remove" onClick={() => removeSection(si)}>Remove section</button>
            </div>
            <input
              className="card-input"
              value={sec.title}
              onChange={(e) => patchSection(si, { title: e.target.value })}
              placeholder="Section title"
              aria-label={`Section ${si + 1} title`}
              style={{ width: "100%", marginBottom: 10 }}
            />

            <div className="mod-edit-subs">
              {sec.subsections.map((sub, sj) => (
                <div key={sub.id} className="mod-edit-sub">
                  <div className="mod-edit-sub-head">
                    <span className="mod-edit-sub-num">Subsection {sj + 1}</span>
                    <button type="button" className="card-edit-remove" onClick={() => removeSub(si, sj)}>Remove</button>
                  </div>
                  <input
                    className="card-input"
                    value={sub.title}
                    onChange={(e) => patchSub(si, sj, { title: e.target.value })}
                    placeholder="Subsection title (shown in the left nav)"
                    aria-label={`Subsection ${sj + 1} title`}
                    style={{ width: "100%", marginBottom: 10 }}
                  />

                  <div className="mod-kind-tabs" role="tablist" aria-label="Content type">
                    {KINDS.map((k) => (
                      <button
                        key={k.id}
                        type="button"
                        role="tab"
                        aria-selected={sub.kind === k.id}
                        className={`mod-kind-tab${sub.kind === k.id ? " is-active" : ""}`}
                        onClick={() => patchSub(si, sj, { kind: k.id })}
                      >
                        {k.label}
                      </button>
                    ))}
                  </div>

                  {sub.kind === "google" && (
                    <input
                      className="card-input"
                      value={sub.slides}
                      onChange={(e) => patchSub(si, sj, { slides: e.target.value })}
                      placeholder="Google Slides or Docs link (share as 'anyone with the link')"
                      aria-label="Google link"
                      style={{ width: "100%" }}
                    />
                  )}
                  {sub.kind === "pdf" && (
                    <div className="mod-pdf-field">
                      {sub.docId ? (
                        <span className="mod-pdf-attached">PDF attached{sub.docName ? `: ${sub.docName}` : ""}</span>
                      ) : (
                        <span className="dash-sub">No PDF yet.</span>
                      )}
                      <label className="btn mod-pdf-upload">
                        {uploadingId === sub.id ? "Uploading..." : sub.docId ? "Replace PDF" : "Upload PDF"}
                        <input
                          type="file"
                          accept="application/pdf,.pdf"
                          hidden
                          disabled={uploadingId === sub.id}
                          onChange={(e) => { void uploadPdf(si, sj, sub, e.target.files?.[0]); e.target.value = ""; }}
                        />
                      </label>
                    </div>
                  )}
                  {sub.kind === "info" && (
                    <textarea
                      className="feedback-text"
                      value={sub.body}
                      onChange={(e) => patchSub(si, sj, { body: e.target.value })}
                      placeholder="Write the info for this subsection. New lines become paragraphs."
                      rows={5}
                      maxLength={10000}
                    />
                  )}
                </div>
              ))}
              <button type="button" className="btn" onClick={() => addSub(si)}>+ Add subsection</button>
            </div>
          </div>
        ))}
        <div><button type="button" className="btn" onClick={addSection}>+ Add section</button></div>
      </div>

      {error && <p className="upload-error" role="alert">{error}</p>}
      <div className="upload-actions">
        <Link className="cta" href={`/modules/${moduleId}`}>Play it</Link>
        <Link className="btn" href="/dashboard?section=modules">Done</Link>
        <SaveStatusChip status={status} />
      </div>
      </form>

      <aside className="mod-editor-preview" aria-label="Student preview">
        <div className="mod-preview-head">
          <span className="mod-preview-label">Live preview</span>
          <span className="dash-sub" style={{ fontSize: 12 }}>What students see · updates when changes save</span>
        </div>
        <div className="mod-preview-frame">
          {/* The real student player, re-fetched after each save so the admin
              sees exactly what a student sees while building. */}
          <ModulePlayer key={previewVersion} moduleId={moduleId} />
        </div>
      </aside>
    </div>
  );
}

function SaveStatusChip({ status }: { status: SaveStatus }) {
  return (
    <span className={`save-status save-status-${status}`} aria-live="polite">
      {status === "saving" ? "Saving..." : status === "error" ? "Save failed" : "All changes saved"}
    </span>
  );
}
