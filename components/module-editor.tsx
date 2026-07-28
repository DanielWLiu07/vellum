"use client";

import Link from "next/link";
import * as React from "react";

import { renderMarkdown } from "@/lib/markdown";
import { RETURN_TO, returnLabel, withBack } from "@/lib/return-to";

import { SlidesScroll } from "./slides-scroll";
import { useAutosave, type SaveStatus } from "./use-autosave";

type EditorKind = "google" | "pdf" | "info";
type Subsection = { id: string; title: string; kind: EditorKind; slides: string; docId: string; docName: string; body: string };
type Section = { id: string; title: string; subsections: Subsection[] };
type GoogleRef = { id: string; kind: "slides" | "doc"; pub: boolean };
type Step = { si: number; sj: number; secTitle: string; sub: Subsection };
type Mode = "scroll" | "slideshow";

const uid = (p: string) => `${p}_${crypto.randomUUID().slice(0, 8)}`;
const blankSub = (): Subsection => ({ id: uid("ss"), title: "", kind: "google", slides: "", docId: "", docName: "", body: "" });
const blankSection = (): Section => ({ id: uid("sec"), title: "", subsections: [blankSub()] });

// Reconstruct an editable Google link from a stored id so the field round-trips.
const linkFor = (ss: { slidesId?: string; kind?: string; slidesPub?: boolean }) => {
  if (!ss.slidesId) return "";
  const type = ss.kind === "doc" ? "document" : "presentation";
  return `https://docs.google.com/${type}/d/${ss.slidesPub ? "e/" : ""}${ss.slidesId}/edit`;
};

// Client-side twin of lib/modules' parseSlides - the server normalizes the same
// way on save; this is only so the stage can preview what you just pasted.
function parseLink(input: string): GoogleRef | null {
  const s = String(input ?? "").trim().slice(0, 600);
  if (!s) return null;
  if (/^[A-Za-z0-9_-]{20,}$/.test(s)) return { id: s, kind: "slides", pub: false }; // bare id -> assume slides
  if (!/^https:\/\/docs\.google\.com\//.test(s)) return null;
  for (const [type, kind] of [["presentation", "slides"], ["document", "doc"]] as const) {
    const pub = s.match(new RegExp(`/${type}/d/e/([A-Za-z0-9_-]+)`));
    if (pub) return { id: pub[1]!, kind, pub: true };
    const file = s.match(new RegExp(`/${type}/d/([A-Za-z0-9_-]+)`));
    if (file) return { id: file[1]!, kind, pub: false };
  }
  return null;
}

const embedUrl = (g: GoogleRef) => {
  const e = g.pub ? "e/" : "";
  return g.kind === "doc"
    ? `https://docs.google.com/document/d/${e}${g.id}/${g.pub ? "pub" : "preview"}`
    : `https://docs.google.com/presentation/d/${e}${g.id}/embed`;
};

/** Mirrors the player's "does this subsection have anything in it" test. */
const hasContent = (s: Subsection) =>
  s.kind === "info" ? Boolean(s.body.trim()) : s.kind === "pdf" ? Boolean(s.docId) : Boolean(parseLink(s.slides));

const flatten = (xs: Section[]): Step[] => {
  const out: Step[] = [];
  xs.forEach((sec, si) => sec.subsections.forEach((sub, sj) => out.push({ si, sj, secTitle: sec.title, sub })));
  return out;
};

const pdfDocIds = (xs: Section[]) =>
  new Set(xs.flatMap((s) => s.subsections.filter((ss) => ss.kind === "pdf" && ss.docId).map((ss) => ss.docId)));

const KINDS: { id: EditorKind; label: string }[] = [
  { id: "google", label: "Google Slides / Docs" },
  { id: "pdf", label: "PDF upload" },
  { id: "info", label: "Written info" },
];

/**
 * Admin editor for a learning module, built as the student view with the pieces
 * made editable in place: the same left nav (sections -> subsections) and the
 * same stage, so what you're editing is what a student sees. The nav owns
 * structure (add / rename / reorder / delete); the stage owns the selected
 * subsection's content. Live-autosaved.
 */
export function ModuleEditor({ moduleId, backHref = RETURN_TO.modules, selfHref }: {
  moduleId: string;
  /** Validated destination for "Done" and the sidebar's way out. */
  backHref?: string;
  /** This editor's own URL, handed to "Play it" so it comes back here. */
  selfHref?: string;
}) {
  const backLabel = returnLabel(backHref);
  const [title, setTitle] = React.useState("");
  const [summary, setSummary] = React.useState("");
  const [sections, setSections] = React.useState<Section[]>([blankSection()]);
  const [state, setState] = React.useState<"loading" | "ready" | "denied">("loading");
  const [error, setError] = React.useState<string | null>(null);
  const [uploadingId, setUploadingId] = React.useState<string | null>(null);
  const [selId, setSelId] = React.useState<string | null>(null);
  const [collapsed, setCollapsed] = React.useState<Set<string>>(new Set());
  const [mode, setMode] = React.useState<Mode>("scroll");
  // Written info is Markdown: write it, or see it rendered exactly as students
  // will read it. Same toggle shape as the player's Scroll/Slideshow control.
  const [infoView, setInfoView] = React.useState<"write" | "preview">("write");
  // Uploaded PDFs only render once the module references them (the render
  // endpoint gates on that), so the stage waits for the save to land.
  const [savedDocs, setSavedDocs] = React.useState<Set<string>>(new Set());
  // Settled copy of the pasted Google link, so the preview doesn't refetch on
  // every keystroke. Tagged with the subsection it belongs to, so switching
  // subsections isn't held up by the debounce.
  const [previewFor, setPreviewLink] = React.useState({ id: "", link: "" });
  const saveAbort = React.useRef<AbortController | null>(null);

  const modeKey = "vitals-module-mode";

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
      const next = loaded.length ? loaded : [blankSection()];
      setSections(next);
      setSavedDocs(pdfDocIds(next));
      setSelId(next[0]?.subsections[0]?.id ?? null);
      setState("ready");
    })();
    return () => { cancelled = true; };
  }, [moduleId]);

  React.useEffect(() => {
    try {
      const raw = localStorage.getItem(modeKey);
      queueMicrotask(() => { if (raw === "slideshow" || raw === "scroll") setMode(raw); });
    } catch { /* ignore */ }
  }, []);
  const chooseMode = (m: Mode) => { setMode(m); try { localStorage.setItem(modeKey, m); } catch { /* ignore */ } };

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
      if (res.ok) { setError(null); setSavedDocs(pdfDocIds(sections)); return true; }
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

  const steps = React.useMemo(() => flatten(sections), [sections]);
  const found = steps.findIndex((s) => s.sub.id === selId);
  const stepIdx = found >= 0 ? found : 0;
  const step: Step | undefined = steps[stepIdx];
  const sub = step?.sub;

  const subId = sub?.id ?? "";
  const subKind = sub?.kind ?? "google";
  const subSlides = sub?.slides ?? "";
  const liveLink = subKind === "google" ? subSlides : "";
  React.useEffect(() => {
    const t = setTimeout(() => setPreviewLink({ id: subId, link: liveLink }), 500);
    return () => clearTimeout(t);
  }, [subId, liveLink]);
  // Typing in the current subsection uses the settled value; switching to a
  // different one swaps the stage straight away.
  const previewLink = previewFor.id === subId ? previewFor.link : liveLink;

  const patchSection = (si: number, p: Partial<Section>) => setSections((xs) => xs.map((s, i) => (i === si ? { ...s, ...p } : s)));
  const patchSub = (si: number, sj: number, p: Partial<Subsection>) =>
    setSections((xs) => xs.map((s, i) => (i === si ? { ...s, subsections: s.subsections.map((ss, j) => (j === sj ? { ...ss, ...p } : ss)) } : s)));

  /** Replace the structure and re-anchor the selection near `preferIdx`. */
  const replaceSections = (next: Section[], preferIdx: number) => {
    setSections(next);
    const flat = flatten(next);
    const pick = flat[Math.min(Math.max(preferIdx, 0), flat.length - 1)];
    setSelId(pick?.sub.id ?? null);
  };

  const select = (id: string) => setSelId(id);
  const openSection = (id: string) => setCollapsed((c) => { if (!c.has(id)) return c; const n = new Set(c); n.delete(id); return n; });
  const toggleSection = (id: string) => setCollapsed((c) => { const n = new Set(c); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const go = (delta: number) => {
    const target = steps[Math.min(steps.length - 1, Math.max(0, stepIdx + delta))];
    if (!target) return;
    setSelId(target.sub.id);
    const sec = sections[target.si];
    if (sec) openSection(sec.id);
  };

  const addSection = () => {
    const sec = blankSection();
    setSections((xs) => [...xs, sec]);
    setSelId(sec.subsections[0]!.id);
  };
  const removeSection = (si: number) => {
    if (sections.length <= 1) return;
    const at = steps.findIndex((s) => s.si === si);
    replaceSections(sections.filter((_, i) => i !== si), at);
  };
  const moveSection = (si: number, dir: -1 | 1) => {
    const to = si + dir;
    if (to < 0 || to >= sections.length) return;
    const next = [...sections];
    [next[si], next[to]] = [next[to]!, next[si]!];
    setSections(next);
  };

  const addSub = (si: number) => {
    const ss = blankSub();
    patchSection(si, { subsections: [...sections[si]!.subsections, ss] });
    setSelId(ss.id);
    const sec = sections[si];
    if (sec) openSection(sec.id);
  };
  const removeSub = (si: number, sj: number) => {
    const s = sections[si]!;
    if (s.subsections.length <= 1) return;
    const at = steps.findIndex((x) => x.si === si && x.sj === sj);
    replaceSections(
      sections.map((sec, i) => (i === si ? { ...sec, subsections: sec.subsections.filter((_, j) => j !== sj) } : sec)),
      at,
    );
  };
  const moveSub = (si: number, sj: number, dir: -1 | 1) => {
    const subs = sections[si]!.subsections;
    const to = sj + dir;
    if (to < 0 || to >= subs.length) return;
    const next = [...subs];
    [next[sj], next[to]] = [next[to]!, next[sj]!];
    patchSection(si, { subsections: next });
  };

  async function uploadPdf(si: number, sj: number, target: Subsection, file: File | undefined) {
    if (!file) return;
    setUploadingId(target.id);
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
        <Link className="btn" href={backHref}>← {backLabel}</Link>
      </div>
    );
  }

  const ref = sub && sub.kind === "google" ? parseLink(previewLink) : null;
  // Scroll view needs a renderable PDF source: a Google FILE (not a published
  // /d/e/ id) or an uploaded PDF that's already saved onto the module.
  const canScroll = Boolean(ref && !ref.pub);
  const showScroll = mode === "scroll" && canScroll;
  const section = step ? sections[step.si] : undefined;

  return (
    <div className="module-shell mod-edit-shell">
      <aside className="module-sidebar">
        <Link className="dash-back" href={backHref}>← {backLabel}</Link>

        <input
          className="module-side-title mod-edit-inline"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Untitled module"
          aria-label="Module title"
          maxLength={120}
        />
        <input
          className="mod-edit-side-summary mod-edit-inline"
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          placeholder="Add a one-line summary"
          aria-label="Module summary"
          maxLength={240}
        />
        <SaveStatusChip status={status} />

        <div className="module-section-list">
          {sections.map((sec, si) => {
            const open = !collapsed.has(sec.id);
            return (
              <div key={sec.id} className="module-section">
                <div className="module-section-head mod-edit-section-head">
                  <button
                    type="button"
                    className="mod-edit-caret"
                    aria-expanded={open}
                    aria-label={`${open ? "Collapse" : "Expand"} section ${si + 1}`}
                    onClick={() => toggleSection(sec.id)}
                  >
                    <span className={`module-caret${open ? " is-open" : ""}`} aria-hidden>▸</span>
                  </button>
                  <input
                    className="module-section-name mod-edit-inline mod-edit-section-input"
                    value={sec.title}
                    onChange={(e) => patchSection(si, { title: e.target.value })}
                    placeholder={`Section ${si + 1}`}
                    aria-label={`Section ${si + 1} title`}
                    maxLength={120}
                  />
                  <span className="module-section-count">{sec.subsections.length}</span>
                  <RowTools
                    label={`section ${si + 1}`}
                    onUp={() => moveSection(si, -1)}
                    onDown={() => moveSection(si, 1)}
                    onRemove={() => removeSection(si)}
                    upDisabled={si === 0}
                    downDisabled={si === sections.length - 1}
                    removeDisabled={sections.length <= 1}
                  />
                </div>

                {open && (
                  <ul className="module-sub-list">
                    {sec.subsections.map((ss, sj) => {
                      const active = ss.id === sub?.id;
                      return (
                        <li key={ss.id} className={`module-sub${active ? " is-active" : ""}`}>
                          {active ? (
                            <input
                              className="module-sub-name mod-edit-inline mod-edit-sub-input"
                              value={ss.title}
                              onChange={(e) => patchSub(si, sj, { title: e.target.value })}
                              placeholder={`Part ${sj + 1}`}
                              aria-label={`Subsection ${sj + 1} title`}
                              maxLength={120}
                            />
                          ) : (
                            <button type="button" className="module-sub-name" onClick={() => select(ss.id)}>
                              {ss.title || `Part ${sj + 1}`}{!hasContent(ss) ? " · (empty)" : ""}
                            </button>
                          )}
                          <RowTools
                            label={`subsection ${sj + 1}`}
                            onUp={() => moveSub(si, sj, -1)}
                            onDown={() => moveSub(si, sj, 1)}
                            onRemove={() => removeSub(si, sj)}
                            upDisabled={sj === 0}
                            downDisabled={sj === sec.subsections.length - 1}
                            removeDisabled={sec.subsections.length <= 1}
                          />
                        </li>
                      );
                    })}
                    <li className="mod-edit-add-row">
                      <button type="button" className="mod-edit-add" onClick={() => addSub(si)}>+ Add subsection</button>
                    </li>
                  </ul>
                )}
              </div>
            );
          })}
          <button type="button" className="mod-edit-add" onClick={addSection}>+ Add section</button>
        </div>

        <div className="mod-edit-side-actions">
          <Link className="cta" href={withBack(`/modules/${moduleId}`, selfHref ?? backHref)}>Play it</Link>
          <Link className="btn" href={backHref}>Done · {backLabel}</Link>
        </div>
      </aside>

      <main className="module-stage">
        {error && <p className="upload-error" role="alert">{error}</p>}
        {!step || !sub ? (
          <div className="module-embed-empty">
            <p className="module-embed-empty-title">Nothing to edit yet</p>
            <p className="dash-sub">Add a section in the left nav to start building this module.</p>
          </div>
        ) : (
          <>
            <div className="module-stage-head">
              <div className="module-stage-titles">
                <p className="module-slide-kicker">{section?.title || `Section ${step.si + 1}`}</p>
                <input
                  className="module-stage-title mod-edit-inline"
                  value={sub.title}
                  onChange={(e) => patchSub(step.si, step.sj, { title: e.target.value })}
                  placeholder={`Part ${step.sj + 1}`}
                  aria-label="Subsection title"
                  maxLength={120}
                />
              </div>
              <div className="mod-kind-tabs" role="tablist" aria-label="Content type">
                {KINDS.map((k) => (
                  <button
                    key={k.id}
                    type="button"
                    role="tab"
                    aria-selected={sub.kind === k.id}
                    className={`mod-kind-tab${sub.kind === k.id ? " is-active" : ""}`}
                    onClick={() => patchSub(step.si, step.sj, { kind: k.id })}
                  >
                    {k.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Source row: whatever this subsection's kind needs to point at its
                content, sitting right above the preview it feeds. */}
            <div className="mod-edit-source">
              {sub.kind === "google" && (
                <input
                  className="card-input"
                  value={sub.slides}
                  onChange={(e) => patchSub(step.si, step.sj, { slides: e.target.value })}
                  placeholder="Google Slides or Docs link (share as 'anyone with the link')"
                  aria-label="Google Slides or Docs link"
                  maxLength={600}
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
                      onChange={(e) => { void uploadPdf(step.si, step.sj, sub, e.target.files?.[0]); e.target.value = ""; }}
                    />
                  </label>
                </div>
              )}
              {sub.kind === "info" && (
                <>
                  <p className="dash-sub">
                    Markdown: <code className="md-code"># heading</code>, <code className="md-code">**bold**</code>,{" "}
                    <code className="md-code">- list</code>, <code className="md-code">[text](https://...)</code>.
                  </p>
                  <div className="module-mode" role="tablist" aria-label="Written info view">
                    <button type="button" role="tab" aria-selected={infoView === "write"} className={`module-mode-btn${infoView === "write" ? " is-active" : ""}`} onClick={() => setInfoView("write")}>Write</button>
                    <button type="button" role="tab" aria-selected={infoView === "preview"} className={`module-mode-btn${infoView === "preview" ? " is-active" : ""}`} onClick={() => setInfoView("preview")}>Preview</button>
                  </div>
                </>
              )}
              {sub.kind === "google" && canScroll && (
                <div className="module-mode" role="tablist" aria-label="View mode">
                  <button type="button" role="tab" aria-selected={mode === "scroll"} className={`module-mode-btn${mode === "scroll" ? " is-active" : ""}`} onClick={() => chooseMode("scroll")}>Scroll</button>
                  <button type="button" role="tab" aria-selected={mode === "slideshow"} className={`module-mode-btn${mode === "slideshow" ? " is-active" : ""}`} onClick={() => chooseMode("slideshow")}>Slideshow</button>
                </div>
              )}
            </div>

            {sub.kind === "info" ? (
              infoView === "preview" ? (
                // Exactly what the player renders, from the same renderer - down
                // to the empty tile it shows for a subsection with no text.
                !sub.body.trim() ? (
                  <StageEmpty>Nothing written yet. Switch to Write and the rendered Markdown appears here.</StageEmpty>
                ) : (
                  <article className="module-info" dangerouslySetInnerHTML={{ __html: renderMarkdown(sub.body) }} />
                )
              ) : (
                // The student's info article, but you type straight into it.
                <textarea
                  key={sub.id}
                  className="module-info mod-edit-info"
                  value={sub.body}
                  onChange={(e) => patchSub(step.si, step.sj, { body: e.target.value })}
                  placeholder="Write the info for this subsection. Markdown works - blank line between paragraphs."
                  aria-label="Subsection text (Markdown)"
                  maxLength={10000}
                />
              )
            ) : sub.kind === "pdf" ? (
              !sub.docId ? (
                <StageEmpty>Upload a PDF and its pages appear here, exactly as students see them.</StageEmpty>
              ) : !savedDocs.has(sub.docId) ? (
                <p className="module-note">Preparing the preview - the pages appear as soon as this change saves.</p>
              ) : (
                <div className="module-scroll-viewer">
                  <SlidesScroll key={sub.docId} id={sub.docId} kind="pdf" title={sub.title || "PDF"} />
                </div>
              )
            ) : !previewLink.trim() ? (
              <StageEmpty>Paste a Google Slides or Docs link above and the deck appears here, exactly as students see it.</StageEmpty>
            ) : !ref ? (
              <p className="module-note">
                That doesn&apos;t look like a Google Slides or Docs link. Paste the full https://docs.google.com/... URL from the browser bar.
              </p>
            ) : showScroll ? (
              <div className="module-scroll-viewer">
                <SlidesScroll key={`${ref.kind}:${ref.id}`} id={ref.id} kind={ref.kind} title={sub.title || "Deck"} />
              </div>
            ) : (
              <>
                {mode === "scroll" && (
                  <p className="module-note">This deck is published-only, so the scroll view isn&apos;t available - showing the slideshow. Share it as a file (&quot;anyone with the link&quot;) to enable scroll.</p>
                )}
                <div className="module-embed-frame">
                  <iframe className="module-embed" src={embedUrl(ref)} title={sub.title || "Deck"} allowFullScreen allow="fullscreen" />
                </div>
              </>
            )}

            <div className="module-nav">
              <button type="button" className="btn" disabled={stepIdx === 0} onClick={() => go(-1)}>← Previous</button>
              <span className="mod-edit-step-count">{stepIdx + 1} / {steps.length}</span>
              <button type="button" className="btn" disabled={stepIdx === steps.length - 1} onClick={() => go(1)}>Next →</button>
            </div>
          </>
        )}
      </main>
    </div>
  );
}

/** Reorder + delete controls for one nav row. */
function RowTools({
  label, onUp, onDown, onRemove, upDisabled, downDisabled, removeDisabled,
}: {
  label: string;
  onUp: () => void;
  onDown: () => void;
  onRemove: () => void;
  upDisabled: boolean;
  downDisabled: boolean;
  removeDisabled: boolean;
}) {
  return (
    <span className="mod-edit-tools">
      <button type="button" className="mod-edit-tool" aria-label={`Move ${label} up`} disabled={upDisabled} onClick={onUp}>↑</button>
      <button type="button" className="mod-edit-tool" aria-label={`Move ${label} down`} disabled={downDisabled} onClick={onDown}>↓</button>
      <button type="button" className="mod-edit-tool is-danger" aria-label={`Delete ${label}`} disabled={removeDisabled} onClick={onRemove}>×</button>
    </span>
  );
}

/** The player's "nothing here yet" tile, with editor-facing wording. */
function StageEmpty({ children }: { children: React.ReactNode }) {
  return (
    <div className="module-embed-empty">
      <p className="module-embed-empty-title">Nothing here yet</p>
      <p className="dash-sub">{children}</p>
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
