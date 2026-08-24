"use client";

import Link from "next/link";
import * as React from "react";

import { autosaveInit } from "@/lib/autosave-request";
import { renderMarkdown } from "@/lib/markdown";
import { RETURN_TO, returnLabel, withBack } from "@/lib/return-to";

import { AssignToPeople } from "./assign-to-people";
import { SlidesScroll } from "./slides-scroll";
import { canAssign, useMe } from "./use-assignments";
import { useAutosave, type SaveStatus } from "./use-autosave";

/**
 * "google" is one tab in this editor, not one stored kind: an author picks
 * "Google Slides / Docs" and the pasted link decides which of the two it is.
 * The wire payload resolves it (see toWire) so the server never has to guess.
 */
type EditorKind = "google" | "pdf" | "info";
/**
 * A block, flat - every payload present whatever the kind. The stored model
 * (lib/modules' Block) is a discriminated union instead, and deliberately so;
 * here the flat shape is the point, because switching a block from Written info
 * to PDF and back must not throw away the paragraph you already typed.
 */
type EditorBlock = { id: string; kind: EditorKind; slides: string; docId: string; docName: string; body: string };
type Subsection = { id: string; title: string; blocks: EditorBlock[] };
type Section = { id: string; title: string; subsections: Subsection[] };
type GoogleRef = { id: string; kind: "slides" | "doc"; pub: boolean };
type Step = { si: number; sj: number; secTitle: string; sub: Subsection };
type Mode = "scroll" | "slideshow";

const uid = (p: string) => `${p}_${crypto.randomUUID().slice(0, 8)}`;
const blankBlock = (kind: EditorKind): EditorBlock => ({ id: uid("b"), kind, slides: "", docId: "", docName: "", body: "" });
const blankSub = (): Subsection => ({ id: uid("ss"), title: "", blocks: [blankBlock("google")] });
const blankSection = (): Section => ({ id: uid("sec"), title: "", subsections: [blankSub()] });

// Reconstruct an editable Google link from a stored id so the field round-trips.
// The link is what carries slides-vs-doc, so rebuilding it is also what keeps a
// Docs block from coming back as a Slides one.
const linkFor = (b: { slidesId?: string; kind?: string; slidesPub?: boolean }) => {
  if (!b.slidesId) return "";
  const type = b.kind === "doc" ? "document" : "presentation";
  return `https://docs.google.com/${type}/d/${b.slidesPub ? "e/" : ""}${b.slidesId}/edit`;
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

/** Mirrors the player's "is there anything in this block" test. */
const blockHasContent = (b: EditorBlock) =>
  b.kind === "info" ? Boolean(b.body.trim()) : b.kind === "pdf" ? Boolean(b.docId) : Boolean(parseLink(b.slides));
const hasContent = (s: Subsection) => s.blocks.some(blockHasContent);

const flatten = (xs: Section[]): Step[] => {
  const out: Step[] = [];
  xs.forEach((sec, si) => sec.subsections.forEach((sub, sj) => out.push({ si, sj, secTitle: sec.title, sub })));
  return out;
};

const pdfDocIds = (xs: Section[]) =>
  new Set(xs.flatMap((s) => s.subsections.flatMap((ss) => ss.blocks.filter((b) => b.kind === "pdf" && b.docId).map((b) => b.docId))));

/**
 * What actually gets saved: the stored block shape, with the Google kind
 * resolved from the pasted link and the editor-only fields (docName, the
 * payloads belonging to kinds this block isn't) left behind. Doubles as the
 * autosave dirty key, so a change the server would ignore doesn't trigger a save.
 */
const toWire = (xs: Section[]) =>
  xs.map((sec) => ({
    id: sec.id,
    title: sec.title,
    subsections: sec.subsections.map((ss) => ({
      id: ss.id,
      title: ss.title,
      blocks: ss.blocks.map((b) =>
        b.kind === "info"
          ? { id: b.id, kind: "info", body: b.body }
          : b.kind === "pdf"
            ? { id: b.id, kind: "pdf", docId: b.docId }
            : { id: b.id, kind: parseLink(b.slides)?.kind ?? "slides", slides: b.slides },
      ),
    })),
  }));

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
 * part's blocks, stacked in the order they'll be read. Live-autosaved.
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
  // will read it. Per BLOCK, not per part - two notes in one part are usually
  // at different stages of being written.
  const [previewing, setPreviewing] = React.useState<Set<string>>(new Set());
  // Uploaded PDFs only render once the module references them (the render
  // endpoint gates on that), so the stage waits for the save to land.
  const [savedDocs, setSavedDocs] = React.useState<Set<string>>(new Set());
  // Settled copy of the current part's pasted Google links, so a preview doesn't
  // refetch on every keystroke. Tagged with the part it belongs to, so switching
  // parts swaps the stage straight away instead of waiting out the debounce.
  const [settled, setSettled] = React.useState<{ subId: string; links: Record<string, string> }>({ subId: "", links: {} });
  const saveAbort = React.useRef<AbortController | null>(null);
  // Handing the module out from the page where it is authored: the resource is
  // already chosen here, so the modal only has to ask who gets it.
  const [assigning, setAssigning] = React.useState(false);
  const [assignFlash, setAssignFlash] = React.useState<string | null>(null);
  // The SERVER's role. Only an admin reaches this editor at all, but canAssign
  // is the authority on who may hand work out and it is not the same predicate.
  const me = useMe();

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
      // Every part arrives with a blocks array: lib/modules migrates the
      // pre-blocks shape on the way out of the store, so the editor has one
      // shape to read and an old module opens with its content intact.
      const loaded: Section[] = (j.module.sections ?? []).map((s: { id?: string; title?: string; subsections?: unknown[] }) => ({
        id: s.id ?? uid("sec"),
        title: s.title ?? "",
        // A section with no parts is not editable - the nav has nothing to
        // select - so it opens with one blank part, as it always has.
        subsections: ((s.subsections?.length ? s.subsections : [{}]) as { id?: string; title?: string; blocks?: unknown[] }[]).map((ss) => ({
          id: ss.id ?? uid("ss"),
          title: ss.title ?? "",
          blocks: ((ss.blocks ?? []) as { id?: string; kind?: string; slidesId?: string; slidesPub?: boolean; docId?: string; body?: string }[]).map((b) => ({
            id: b.id ?? uid("b"),
            kind: b.kind === "pdf" ? "pdf" : b.kind === "info" ? "info" : "google",
            slides: linkFor(b),
            docId: b.docId ?? "",
            docName: b.docId ? "Attached PDF" : "",
            body: b.body ?? "",
          })),
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

  const wire = React.useMemo(() => toWire(sections), [sections]);

  async function autosaveNow(): Promise<boolean> {
    saveAbort.current?.abort();
    const ctrl = new AbortController();
    saveAbort.current = ctrl;
    try {
      const res = await fetch(
        `/api/modules/${moduleId}`,
        autosaveInit(JSON.stringify({ title, summary, sections: wire }), ctrl.signal),
      );
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
  const status = useAutosave(autosaveNow, JSON.stringify({ title, summary, wire }), { enabled: state === "ready" });

  const steps = React.useMemo(() => flatten(sections), [sections]);
  const found = steps.findIndex((s) => s.sub.id === selId);
  const stepIdx = found >= 0 ? found : 0;
  const step: Step | undefined = steps[stepIdx];
  const sub = step?.sub;

  const subId = sub?.id ?? "";
  const liveLinks = React.useMemo(
    () => Object.fromEntries((sub?.blocks ?? []).filter((b) => b.kind === "google").map((b) => [b.id, b.slides])),
    [sub],
  );
  React.useEffect(() => {
    const t = setTimeout(() => setSettled({ subId, links: liveLinks }), 500);
    return () => clearTimeout(t);
  }, [subId, liveLinks]);
  // Typing in the current part uses the settled value; a block that didn't exist
  // when it settled (just added) falls back to live, which is empty anyway.
  const settledLink = (b: EditorBlock) => (settled.subId === subId ? settled.links[b.id] ?? b.slides : b.slides);

  const patchSection = (si: number, p: Partial<Section>) => setSections((xs) => xs.map((s, i) => (i === si ? { ...s, ...p } : s)));
  const patchSub = (si: number, sj: number, p: Partial<Subsection>) =>
    setSections((xs) => xs.map((s, i) => (i === si ? { ...s, subsections: s.subsections.map((ss, j) => (j === sj ? { ...ss, ...p } : ss)) } : s)));
  const patchBlock = (si: number, sj: number, bk: number, p: Partial<EditorBlock>) =>
    setSections((xs) =>
      xs.map((s, i) =>
        i === si
          ? { ...s, subsections: s.subsections.map((ss, j) => (j === sj ? { ...ss, blocks: ss.blocks.map((b, k) => (k === bk ? { ...b, ...p } : b)) } : ss)) }
          : s,
      ),
    );

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

  const blocksOf = (si: number, sj: number) => sections[si]!.subsections[sj]!.blocks;
  const addBlock = (si: number, sj: number, kind: EditorKind) =>
    patchSub(si, sj, { blocks: [...blocksOf(si, sj), blankBlock(kind)] });
  // A part is allowed to reach zero blocks - "Add a block" is always on screen
  // below the stack, so an emptied part is never a dead end.
  const removeBlock = (si: number, sj: number, bk: number) =>
    patchSub(si, sj, { blocks: blocksOf(si, sj).filter((_, k) => k !== bk) });
  const moveBlock = (si: number, sj: number, bk: number, dir: -1 | 1) => {
    const blocks = blocksOf(si, sj);
    const to = bk + dir;
    if (to < 0 || to >= blocks.length) return;
    const next = [...blocks];
    [next[bk], next[to]] = [next[to]!, next[bk]!];
    patchSub(si, sj, { blocks: next });
  };
  const togglePreview = (blockId: string, on: boolean) =>
    setPreviewing((p) => { const n = new Set(p); if (on) n.add(blockId); else n.delete(blockId); return n; });

  async function uploadPdf(si: number, sj: number, bk: number, blockId: string, file: File | undefined) {
    if (!file) return;
    setUploadingId(blockId);
    try {
      const fd = new FormData();
      fd.set("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: fd }).catch(() => null);
      const j = res?.ok ? await res.json().catch(() => null) : null;
      if (j?.id) patchBlock(si, sj, bk, { docId: j.id, docName: j.name ?? file.name });
      else setError(res?.status === 415 ? "That wasn't a PDF - upload a .pdf file." : "Couldn't upload that PDF.");
    } finally {
      setUploadingId(null);
    }
  }

  if (state === "loading") return <div className="upload-card"><p className="dash-sub">Loading the module...</p></div>;
  if (state === "denied") {
    // Two different refusals wore one message. Signed in as an admin, opening a
    // module that plainly exists and whose header offers "Play this module",
    // being told it "doesn't exist, or you're not an admin" is simply false -
    // the real reason is that the seeded sample is immutable.
    const sampleModule = moduleId === "sample-module";
    return (
      <div className="upload-card">
        <h1 className="upload-h">Can&apos;t edit this module</h1>
        <p className="dash-sub">
          {sampleModule
            ? "The sample module is read-only - it's the built-in example every deployment starts with. Make a new module, or copy this one's structure into it."
            : "It doesn't exist, or you're not an admin. Modules are authored by HOSA staff."}
        </p>
        <Link className="btn" href={backHref}>← {backLabel}</Link>
      </div>
    );
  }

  const partBlocks = sub?.blocks ?? [];
  // One toggle for the part, as in the player. Scroll needs a renderable PDF
  // source, so it's offered only when some deck here is a Google FILE (a
  // published /d/e/ id can't export).
  const canToggleMode = partBlocks.some((b) => b.kind === "google" && parseLink(settledLink(b))?.pub === false);
  // The fixed-height scroll box survives only for a part holding one block -
  // see the same rule, and the reason for it, in the player.
  const boxed = partBlocks.length === 1;
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
          {canAssign(me?.role) && (
            <button type="button" className="btn" onClick={() => setAssigning(true)}>Assign to...</button>
          )}
          <Link className="btn" href={backHref}>Done · {backLabel}</Link>
        </div>
        {assignFlash && <p className="dash-sub" role="status" style={{ marginTop: 10 }}>{assignFlash}</p>}
      </aside>

      {assigning && (
        <AssignToPeople
          resource={{ kind: "module", id: moduleId, title: title || "Untitled module" }}
          onClose={() => setAssigning(false)}
          notify={setAssignFlash}
        />
      )}

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
              {canToggleMode && (
                <div className="module-mode" role="tablist" aria-label="View mode">
                  <button type="button" role="tab" aria-selected={mode === "scroll"} className={`module-mode-btn${mode === "scroll" ? " is-active" : ""}`} onClick={() => chooseMode("scroll")}>Scroll</button>
                  <button type="button" role="tab" aria-selected={mode === "slideshow"} className={`module-mode-btn${mode === "slideshow" ? " is-active" : ""}`} onClick={() => chooseMode("slideshow")}>Slideshow</button>
                </div>
              )}
            </div>

            {/* The part's blocks, in the order a student reads them. Each card
                carries its own kind picker, source field and preview; the
                module-section class is here for its one rule - it reveals the
                reorder tools on hover, exactly as it does in the nav. */}
            <div className="module-scroll">
              {partBlocks.length === 0 && (
                <StageEmpty>This part is empty. Add a block below and it appears here, exactly as students see it.</StageEmpty>
              )}

              {partBlocks.map((b, bk) => (
                <div key={b.id} className="module-scroll-item module-section">
                  <div className="module-scroll-head">
                    <div className="mod-kind-tabs" role="tablist" aria-label={`Block ${bk + 1} content type`}>
                      {KINDS.map((k) => (
                        <button
                          key={k.id}
                          type="button"
                          role="tab"
                          aria-selected={b.kind === k.id}
                          className={`mod-kind-tab${b.kind === k.id ? " is-active" : ""}`}
                          onClick={() => patchBlock(step.si, step.sj, bk, { kind: k.id })}
                        >
                          {k.label}
                        </button>
                      ))}
                    </div>
                    <RowTools
                      label={`block ${bk + 1}`}
                      onUp={() => moveBlock(step.si, step.sj, bk, -1)}
                      onDown={() => moveBlock(step.si, step.sj, bk, 1)}
                      onRemove={() => removeBlock(step.si, step.sj, bk)}
                      upDisabled={bk === 0}
                      downDisabled={bk === partBlocks.length - 1}
                      removeDisabled={false}
                    />
                  </div>

                  {/* Source row: whatever this block's kind needs to point at
                      its content, sitting right above the preview it feeds. */}
                  <div className="mod-edit-source">
                    {b.kind === "google" && (
                      <input
                        className="card-input"
                        value={b.slides}
                        onChange={(e) => patchBlock(step.si, step.sj, bk, { slides: e.target.value })}
                        placeholder="Google Slides or Docs link (share as 'anyone with the link')"
                        aria-label={`Google Slides or Docs link, block ${bk + 1}`}
                        maxLength={600}
                      />
                    )}
                    {b.kind === "pdf" && (
                      <div className="mod-pdf-field">
                        {b.docId ? (
                          <span className="mod-pdf-attached">PDF attached{b.docName ? `: ${b.docName}` : ""}</span>
                        ) : (
                          <span className="dash-sub">No PDF yet.</span>
                        )}
                        <label className="btn mod-pdf-upload">
                          {uploadingId === b.id ? "Uploading..." : b.docId ? "Replace PDF" : "Upload PDF"}
                          <input
                            type="file"
                            accept="application/pdf,.pdf"
                            hidden
                            disabled={uploadingId === b.id}
                            onChange={(e) => { void uploadPdf(step.si, step.sj, bk, b.id, e.target.files?.[0]); e.target.value = ""; }}
                          />
                        </label>
                      </div>
                    )}
                    {b.kind === "info" && (
                      <>
                        <p className="dash-sub">
                          Markdown: <code className="md-code"># heading</code>, <code className="md-code">**bold**</code>,{" "}
                          <code className="md-code">- list</code>, <code className="md-code">[text](https://...)</code>.
                        </p>
                        <div className="module-mode" role="tablist" aria-label={`Written info view, block ${bk + 1}`}>
                          <button type="button" role="tab" aria-selected={!previewing.has(b.id)} className={`module-mode-btn${!previewing.has(b.id) ? " is-active" : ""}`} onClick={() => togglePreview(b.id, false)}>Write</button>
                          <button type="button" role="tab" aria-selected={previewing.has(b.id)} className={`module-mode-btn${previewing.has(b.id) ? " is-active" : ""}`} onClick={() => togglePreview(b.id, true)}>Preview</button>
                        </div>
                      </>
                    )}
                  </div>

                  <BlockStage
                    block={b}
                    link={settledLink(b)}
                    mode={mode}
                    boxed={boxed}
                    preview={previewing.has(b.id)}
                    uploaded={savedDocs.has(b.docId)}
                    title={sub.title || `Part ${step.sj + 1}`}
                    onBody={(body) => patchBlock(step.si, step.sj, bk, { body })}
                  />
                </div>
              ))}

              <div className="mod-edit-source">
                <span className="dash-sub">Add a block</span>
                <div className="mod-kind-tabs">
                  {KINDS.map((k) => (
                    <button key={k.id} type="button" className="mod-kind-tab" onClick={() => addBlock(step.si, step.sj, k.id)}>
                      + {k.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

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

/** One block's preview - the student's view of it, or the editing surface that
 * replaces it (written info is typed straight into the article it becomes). */
function BlockStage({ block, link, mode, boxed, preview, uploaded, title, onBody }: {
  block: EditorBlock;
  /** The settled (debounced) Google link for this block. */
  link: string;
  mode: Mode;
  boxed: boolean;
  preview: boolean;
  /** Whether this block's uploaded PDF has reached the server yet. */
  uploaded: boolean;
  /** The part's title, for the embed/page labels a screen reader reads. */
  title: string;
  onBody: (body: string) => void;
}) {
  if (block.kind === "info") {
    return preview ? (
      // Exactly what the player renders, from the same renderer - down to the
      // empty tile it shows for a block with no text.
      !block.body.trim() ? (
        <StageEmpty>Nothing written yet. Switch to Write and the rendered Markdown appears here.</StageEmpty>
      ) : (
        <article className="module-info" dangerouslySetInnerHTML={{ __html: renderMarkdown(block.body) }} />
      )
    ) : (
      // The student's info article, but you type straight into it.
      <textarea
        className="module-info mod-edit-info"
        value={block.body}
        onChange={(e) => onBody(e.target.value)}
        placeholder="Write the info for this block. Markdown works - blank line between paragraphs."
        aria-label="Block text (Markdown)"
        maxLength={10000}
      />
    );
  }

  if (block.kind === "pdf") {
    if (!block.docId) return <StageEmpty>Upload a PDF and its pages appear here, exactly as students see them.</StageEmpty>;
    if (!uploaded) return <p className="module-note">Preparing the preview - the pages appear as soon as this change saves.</p>;
    return <Pages boxed={boxed}><SlidesScroll key={block.docId} id={block.docId} kind="pdf" title={title} /></Pages>;
  }

  const ref = parseLink(link);
  if (!link.trim()) return <StageEmpty>Paste a Google Slides or Docs link above and the deck appears here, exactly as students see it.</StageEmpty>;
  if (!ref) {
    return (
      <p className="module-note">
        That doesn&apos;t look like a Google Slides or Docs link. Paste the full https://docs.google.com/... URL from the browser bar.
      </p>
    );
  }
  // Scroll view needs a renderable PDF source: a Google FILE, not a published
  // /d/e/ id.
  if (mode === "scroll" && !ref.pub) {
    return <Pages boxed={boxed}><SlidesScroll key={`${ref.kind}:${ref.id}`} id={ref.id} kind={ref.kind} title={title} /></Pages>;
  }
  return (
    <>
      {mode === "scroll" && (
        <p className="module-note">This deck is published-only, so the scroll view isn&apos;t available - showing the slideshow. Share it as a file (&quot;anyone with the link&quot;) to enable scroll.</p>
      )}
      <div className="module-embed-frame">
        <iframe className="module-embed" src={embedUrl(ref)} title={title} allowFullScreen allow="fullscreen" />
      </div>
    </>
  );
}

/** Rendered pages, boxed in the fixed-height viewer only when this block is the
 * part's only one - see the player for why stacked blocks drop the box. */
function Pages({ boxed, children }: { boxed: boolean; children: React.ReactNode }) {
  return boxed ? <div className="module-scroll-viewer">{children}</div> : <>{children}</>;
}

/** Reorder + delete controls for one nav row or block. */
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

/**
 * The player's "nothing here yet" tile, with editor-facing wording and a
 * fraction of the height.
 *
 * The player reserves a full 16:9 so the layout doesn't jump when the embed
 * loads. An editor block that is empty has nothing arriving to reserve for, and
 * a part with four unfilled blocks became ~2200px of dashed grey to scroll
 * past - the authoring view punished you for adding the blocks you were about
 * to fill in.
 */
function StageEmpty({ children }: { children: React.ReactNode }) {
  return (
    <div className="module-embed-empty is-compact">
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
