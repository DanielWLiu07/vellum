"use client";

import Link from "next/link";
import * as React from "react";

import { renderMarkdown } from "@/lib/markdown";
// Type-only: lib/modules owns the store and reaches node:fs through the durable
// layer, so a VALUE imported from it would follow the module into the client
// bundle. Types don't - which is why the pure helpers below are hand-written
// twins of the ones in lib/modules rather than imports of them.
import type { Block, GoogleBlock, Module, Subsection } from "@/lib/modules";
import { RETURN_TO, returnLabel } from "@/lib/return-to";
import { clearStudy, recordStudy } from "@/lib/study-client";
// Type-only, for the same reason: lib/study-activity owns the study store.
import type { ModuleProgress } from "@/lib/study-activity";

import { Comments } from "./comments";
import { ReportProblem } from "./report-problem";
import { SlidesScroll } from "./slides-scroll";

type Step = { secIdx: number; secTitle: string; sub: Subsection };
type Mode = "scroll" | "slideshow";

function flatten(m: Module): Step[] {
  const out: Step[] = [];
  m.sections.forEach((sec, si) => (sec.subsections ?? []).forEach((sub) => out.push({ secIdx: si, secTitle: sec.title, sub })));
  return out;
}

const isGoogle = (b: Block): b is GoogleBlock => b.kind === "slides" || b.kind === "doc";
// Interactive embed / preview URL (Slides embed, or Docs preview/pub) - google only.
const embedUrl = (b: Block) => {
  if (!isGoogle(b) || !b.slidesId) return "";
  const e = b.slidesPub ? "e/" : "";
  return b.kind === "doc"
    ? `https://docs.google.com/document/d/${e}${b.slidesId}/${b.slidesPub ? "pub" : "preview"}`
    : `https://docs.google.com/presentation/d/${e}${b.slidesId}/embed`;
};
// The stacked scroll view needs a renderable PDF source: a Google FILE (not a
// published /d/e/ id) or an uploaded PDF.
const canScroll = (b: Block) => (isGoogle(b) ? Boolean(b.slidesId) && !b.slidesPub : b.kind === "pdf" && Boolean(b.docId));
const blockHasContent = (b: Block) =>
  b.kind === "info" ? Boolean(b.body.trim()) : b.kind === "pdf" ? Boolean(b.docId) : Boolean(b.slidesId);
/** A part counts if ANY of its blocks has something in it. */
const hasContent = (s: Subsection) => (s.blocks ?? []).some(blockHasContent);

export function ModulePlayer({ moduleId, backHref = RETURN_TO.modules }: {
  moduleId: string;
  /** Validated destination for "Finish" and the sidebar's way out. */
  backHref?: string;
}) {
  const backLabel = returnLabel(backHref);
  const [mod, setMod] = React.useState<Module | null>(null);
  const [err, setErr] = React.useState(false);
  const [mode, setMode] = React.useState<Mode>("scroll");
  const [i, setI] = React.useState(0);
  const [done, setDone] = React.useState<Set<string>>(new Set());
  const [expanded, setExpanded] = React.useState<Set<number>>(new Set());

  const [resumePart, setResumePart] = React.useState<string | null>(null);
  const resumed = React.useRef(false);
  const modeKey = "vitals-module-mode";

  React.useEffect(() => {
    let live = true;
    fetch(`/api/modules/${moduleId}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (live) { if (j?.module) setMod(j.module); else setErr(true); } })
      .catch(() => { if (live) setErr(true); });
    return () => { live = false; };
  }, [moduleId]);

  // The view-mode preference stays in localStorage: it is a property of this
  // browser, not of the member. Progress is not - see below.
  React.useEffect(() => {
    try {
      const rawMode = localStorage.getItem(modeKey);
      queueMicrotask(() => {
        if (rawMode === "slideshow" || rawMode === "scroll") setMode(rawMode);
      });
    } catch { /* ignore */ }
  }, []);

  /**
   * Progress comes from the study store now.
   *
   * It used to live in localStorage, which meant a member's own phone showed
   * none of the work they did on a laptop, and an advisor could see none of it
   * at all - the only completions the platform knew about were the ones a
   * trainer had assigned. Whatever is already ticked on THIS browser is pushed
   * up once and the key deleted; keeping both would leave two answers to the
   * same question and no way to tell which one is right.
   */
  React.useEffect(() => {
    let live = true;
    (async () => {
      const legacyKey = `vitals-module-progress:${moduleId}`;
      let legacy: string[] = [];
      try {
        const raw = localStorage.getItem(legacyKey);
        if (raw) legacy = JSON.parse(raw) as string[];
      } catch { /* unreadable reads the same as absent */ }
      if (Array.isArray(legacy) && legacy.length) {
        await Promise.all(
          legacy.map((part) => recordStudy({ kind: "module", refId: moduleId, part, action: "completed" })),
        );
      }
      try { localStorage.removeItem(legacyKey); } catch { /* ignore */ }

      const res = await fetch(`/api/study/progress?kind=module&refId=${encodeURIComponent(moduleId)}`, {
        cache: "no-store",
      }).catch(() => null);
      if (!live || !res?.ok) return;
      const progress = (await res.json().catch(() => null))?.progress as ModuleProgress | undefined;
      if (!live || !progress) return;
      setDone(new Set(progress.completedParts));
      setResumePart(progress.resumePart);
    })();
    return () => { live = false; };
  }, [moduleId]);

  const chooseMode = (m: Mode) => { setMode(m); try { localStorage.setItem(modeKey, m); } catch { /* ignore */ } };

  const steps = React.useMemo(() => (mod ? flatten(mod) : []), [mod]);
  const totalSubs = steps.length;

  // Drop them back where they stopped, once. Later navigation is theirs. The
  // jump follows a fetch, and the ref makes it a one-shot, so it can't cascade.
  React.useEffect(() => {
    if (resumed.current || !resumePart || steps.length === 0) return;
    resumed.current = true;
    const at = steps.findIndex((s) => s.sub.id === resumePart);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (at > 0) setI(at);
  }, [resumePart, steps]);

  // Opening a subsection is the "self-directed study" signal that nothing used
  // to record. Fire and forget: a lost write costs a resume point, not a lesson.
  const openSubId = steps[Math.min(i, Math.max(0, steps.length - 1))]?.sub.id;
  React.useEffect(() => {
    if (!openSubId) return;
    void recordStudy({ kind: "module", refId: moduleId, part: openSubId, action: "viewed" });
  }, [moduleId, openSubId]);

  /**
   * Tick a subsection off. The checkbox moves immediately and the write
   * follows: gating it on a round-trip makes the module feel broken on a slow
   * connection, and the cost of a failed write is one lost tick.
   */
  const setPartDone = React.useCallback((subId: string, next: boolean) => {
    setDone((prev) => {
      const n = new Set(prev);
      if (next) n.add(subId);
      else n.delete(subId);
      return n;
    });
    void (next
      ? recordStudy({ kind: "module", refId: moduleId, part: subId, action: "completed" })
      : clearStudy({ kind: "module", refId: moduleId, part: subId }));
  }, [moduleId]);

  const next = React.useCallback(() => setI((x) => Math.min(steps.length - 1, x + 1)), [steps.length]);
  const prev = React.useCallback(() => setI((x) => Math.max(0, x - 1)), []);

  if (err) return <div className="upload-card"><p className="dash-sub">Module not found.</p><Link className="btn" href={backHref}>← {backLabel}</Link></div>;
  if (!mod) return <div className="upload-card"><p className="dash-sub">Loading module...</p></div>;
  if (steps.length === 0) {
    return (
      <div className="upload-card">
        <h1 className="upload-h">{mod.title}</h1>
        <p className="dash-sub">This module has no subsections yet.</p>
        <Link className="btn" href={backHref}>← {backLabel}</Link>
      </div>
    );
  }

  const idx = Math.min(i, steps.length - 1);
  const step = steps[idx]!;
  const doneCount = done.size;
  const pct = totalSubs ? Math.round((doneCount / totalSubs) * 100) : 0;

  const toggleDone = (subId: string) => setPartDone(subId, !done.has(subId));
  const markDone = (subId: string) => { if (!done.has(subId)) setPartDone(subId, true); };
  const toggleSection = (si: number) => setExpanded((e) => { const n = new Set(e); if (n.has(si)) n.delete(si); else n.add(si); return n; });

  // Empty blocks are an authoring state, not something to show a student: an
  // admin who added a deck but hasn't pasted the link yet leaves a hole, not an
  // error tile. Drop them, and the part reads as empty when none are left.
  const blocks = (step.sub.blocks ?? []).filter(blockHasContent);
  // Scroll = vertical rendered slides; the toggle only makes sense when some
  // deck in this part can actually export (a published id can't).
  const canToggleMode = blocks.some((b) => isGoogle(b) && !b.slidesPub);

  return (
    <div className="module-shell">
      <aside className="module-sidebar">
        <Link className="dash-back" href={backHref}>← {backLabel}</Link>
        <p className="module-side-title">{mod.title}</p>
        <div className="module-side-progress">
          <div className="module-progress-bar"><span style={{ width: `${pct}%` }} /></div>
          <span className="module-progress-label">{doneCount} / {totalSubs} done</span>
        </div>
        <div className="module-section-list">
          {mod.sections.map((sec, si) => {
            const subs = sec.subsections ?? [];
            const open = expanded.has(si) || si === step.secIdx;
            const secDone = subs.filter((ss) => done.has(ss.id)).length;
            return (
              <div key={sec.id} className="module-section">
                <button type="button" className="module-section-head" aria-expanded={open} onClick={() => toggleSection(si)}>
                  <span className={`module-caret${open ? " is-open" : ""}`} aria-hidden>▸</span>
                  <span className="module-section-name">{sec.title}</span>
                  <span className="module-section-count">{secDone}/{subs.length}</span>
                </button>
                {open && (
                  <ul className="module-sub-list">
                    {subs.map((sub) => {
                      const stepIdx = steps.findIndex((s) => s.sub.id === sub.id);
                      return (
                        <li key={sub.id} className={`module-sub${sub.id === step.sub.id ? " is-active" : ""}`}>
                          <button type="button" className={`module-sub-check${done.has(sub.id) ? " is-done" : ""}`} aria-label={done.has(sub.id) ? "Mark not done" : "Mark done"} aria-pressed={done.has(sub.id)} onClick={() => toggleDone(sub.id)}>
                            {done.has(sub.id) ? "✓" : ""}
                          </button>
                          <button type="button" className="module-sub-name" onClick={() => setI(stepIdx)}>
                            {sub.title}{!hasContent(sub) ? " · (empty)" : ""}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      </aside>

      <main className="module-stage">
        <div className="module-stage-head">
          <div className="module-stage-titles">
            <p className="module-slide-kicker">{step.secTitle}</p>
            <h1 className="module-stage-title">{step.sub.title}</h1>
          </div>
          {/* Scroll / Slideshow toggle, top-right. One toggle for the whole
              part: the mode is a reading preference, not a per-block setting,
              and every deck in the part follows it. */}
          {canToggleMode && (
            <div className="module-mode" role="tablist" aria-label="View mode">
              <button type="button" role="tab" aria-selected={mode === "scroll"} className={`module-mode-btn${mode === "scroll" ? " is-active" : ""}`} onClick={() => chooseMode("scroll")}>Scroll</button>
              <button type="button" role="tab" aria-selected={mode === "slideshow"} className={`module-mode-btn${mode === "slideshow" ? " is-active" : ""}`} onClick={() => chooseMode("slideshow")}>Slideshow</button>
            </div>
          )}
        </div>

        {blocks.length === 0 ? (
          <div className="module-embed-empty">
            <p className="module-embed-empty-title">Nothing here yet</p>
            <p className="dash-sub">An admin can add a Google Slides/Docs link, a PDF, or written info to this part in the module editor.</p>
          </div>
        ) : (
          <div className="module-scroll">
            {blocks.map((b) => (
              <div key={b.id} className="module-scroll-item">
                <PlayerBlock block={b} mode={mode} title={step.sub.title} boxed={blocks.length === 1} />
              </div>
            ))}
          </div>
        )}

        <div className="module-nav">
          <button type="button" className="btn" disabled={idx === 0} onClick={prev}>← Previous</button>
          <button type="button" className={`btn${done.has(step.sub.id) ? " primary" : ""}`} onClick={() => toggleDone(step.sub.id)}>
            {done.has(step.sub.id) ? "✓ Done" : "Mark done"}
          </button>
          {idx === steps.length - 1 ? (
            // End of the module: tick the last subsection off and leave, rather
            // than stranding the member on a slide with nowhere forward.
            <Link className="cta" href={backHref} onClick={() => markDone(step.sub.id)}>Finish · {backLabel}</Link>
          ) : (
            <button type="button" className="cta" onClick={() => { markDone(step.sub.id); next(); }}>Next →</button>
          )}
        </div>

        {/* The two ways to say something about this module, side by side, so
            nobody has to guess which one gets a wrong answer fixed. A div, not
            a p: ReportProblem renders its dialog inline, and a p can't hold it. */}
        <div className="module-note" style={{ marginTop: 20 }}>
          The comments below are a public discussion - other members read them. If something in
          this module is actually wrong, like a bad answer or a broken link, tell staff instead:{" "}
          <ReportProblem target={{ kind: "module", id: mod.id, title: mod.title }} />
        </div>

        <Comments type="module" target={mod.id} />
      </main>
    </div>
  );
}

/**
 * One block of a part.
 *
 * `boxed` keeps the fixed-height scroll viewer for a part holding a SINGLE
 * block - which is every module authored before blocks existed - and drops it
 * as soon as there are more. A column of nested scrollers steals the wheel from
 * the page halfway down a part, and a stacked part is meant to read as one
 * continuous thing.
 */
function PlayerBlock({ block, mode, title, boxed }: { block: Block; mode: Mode; title: string; boxed: boolean }) {
  if (block.kind === "info") {
    // Authored Markdown, rendered straight on the site. renderMarkdown escapes
    // every text run before emitting a tag, so a body can't inject HTML - see
    // the SAFETY note in lib/markdown.
    return <article className="module-info" dangerouslySetInnerHTML={{ __html: renderMarkdown(block.body) }} />;
  }
  if (block.kind === "pdf" || (mode === "scroll" && canScroll(block))) {
    // Stacked, image-rendered pages (uploaded PDF, or a Google file's export).
    const src = block.kind === "pdf" ? block.docId : block.slidesId;
    const pages = <SlidesScroll key={src} id={src} kind={block.kind} title={title} />;
    return boxed ? <div className="module-scroll-viewer">{pages}</div> : pages;
  }
  return (
    <>
      {mode === "scroll" && (
        <p className="module-note">This deck is published-only, so the scroll view isn&apos;t available - showing the slideshow. Share it as a file (&quot;anyone with the link&quot;) to enable scroll.</p>
      )}
      <div className="module-embed-frame">
        <iframe className="module-embed" src={embedUrl(block)} title={title} allowFullScreen allow="fullscreen" />
      </div>
    </>
  );
}
