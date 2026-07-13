"use client";

import Link from "next/link";
import * as React from "react";

import { Comments } from "./comments";
import { SlidesScroll } from "./slides-scroll";

type SubKind = "slides" | "doc" | "pdf" | "info";
type Subsection = { id: string; title: string; kind: SubKind; slidesId: string; slidesPub: boolean; docId: string; body: string };
type Section = { id: string; title: string; subsections: Subsection[] };
type Module = { id: string; title: string; summary?: string; sections: Section[] };

type Step = { secIdx: number; secTitle: string; sub: Subsection };
type Mode = "scroll" | "slideshow";

function flatten(m: Module): Step[] {
  const out: Step[] = [];
  m.sections.forEach((sec, si) => (sec.subsections ?? []).forEach((sub) => out.push({ secIdx: si, secTitle: sec.title, sub })));
  return out;
}

// Interactive embed / preview URL (Slides embed, or Docs preview/pub) - google only.
const embedUrl = (s: Subsection) => {
  if (!s.slidesId || (s.kind !== "slides" && s.kind !== "doc")) return "";
  const e = s.slidesPub ? "e/" : "";
  return s.kind === "doc"
    ? `https://docs.google.com/document/d/${e}${s.slidesId}/${s.slidesPub ? "pub" : "preview"}`
    : `https://docs.google.com/presentation/d/${e}${s.slidesId}/embed`;
};
// The stacked scroll view needs a renderable PDF source: a Google FILE (not a
// published /d/e/ id) or an uploaded PDF.
const canScrollDeck = (s: Subsection) =>
  s.kind === "pdf" ? Boolean(s.docId) : (s.kind === "slides" || s.kind === "doc") && Boolean(s.slidesId) && !s.slidesPub;
const renderSource = (s: Subsection) => (s.kind === "pdf" ? s.docId : s.slidesId);
const hasContent = (s: Subsection) => (s.kind === "info" ? Boolean(s.body.trim()) : s.kind === "pdf" ? Boolean(s.docId) : Boolean(s.slidesId));

export function ModulePlayer({ moduleId }: { moduleId: string }) {
  const [mod, setMod] = React.useState<Module | null>(null);
  const [err, setErr] = React.useState(false);
  const [mode, setMode] = React.useState<Mode>("scroll");
  const [i, setI] = React.useState(0);
  const [done, setDone] = React.useState<Set<string>>(new Set());
  const [expanded, setExpanded] = React.useState<Set<number>>(new Set());

  const progressKey = `vitals-module-progress:${moduleId}`;
  const modeKey = "vitals-module-mode";

  React.useEffect(() => {
    let live = true;
    fetch(`/api/modules/${moduleId}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (live) { if (j?.module) setMod(j.module); else setErr(true); } })
      .catch(() => { if (live) setErr(true); });
    return () => { live = false; };
  }, [moduleId]);

  React.useEffect(() => {
    try {
      const rawDone = localStorage.getItem(progressKey);
      const rawMode = localStorage.getItem(modeKey);
      queueMicrotask(() => {
        if (rawDone) { try { setDone(new Set(JSON.parse(rawDone) as string[])); } catch { /* ignore */ } }
        if (rawMode === "slideshow" || rawMode === "scroll") setMode(rawMode);
      });
    } catch { /* ignore */ }
  }, [progressKey]);

  const saveDone = React.useCallback((n: Set<string>) => {
    setDone(n);
    try { localStorage.setItem(progressKey, JSON.stringify([...n])); } catch { /* ignore */ }
  }, [progressKey]);
  const chooseMode = (m: Mode) => { setMode(m); try { localStorage.setItem(modeKey, m); } catch { /* ignore */ } };

  const steps = React.useMemo(() => (mod ? flatten(mod) : []), [mod]);
  const totalSubs = steps.length;

  const next = React.useCallback(() => setI((x) => Math.min(steps.length - 1, x + 1)), [steps.length]);
  const prev = React.useCallback(() => setI((x) => Math.max(0, x - 1)), []);

  if (err) return <div className="upload-card"><p className="dash-sub">Module not found.</p><Link className="btn" href="/dashboard?section=modules">Back to modules</Link></div>;
  if (!mod) return <div className="upload-card"><p className="dash-sub">Loading module...</p></div>;
  if (steps.length === 0) {
    return (
      <div className="upload-card">
        <h1 className="upload-h">{mod.title}</h1>
        <p className="dash-sub">This module has no subsections yet.</p>
        <Link className="btn" href="/dashboard?section=modules">Back to modules</Link>
      </div>
    );
  }

  const idx = Math.min(i, steps.length - 1);
  const step = steps[idx]!;
  const doneCount = done.size;
  const pct = totalSubs ? Math.round((doneCount / totalSubs) * 100) : 0;

  const toggleDone = (subId: string) => { const n = new Set(done); if (n.has(subId)) n.delete(subId); else n.add(subId); saveDone(n); };
  const markDone = (subId: string) => { if (!done.has(subId)) { const n = new Set(done); n.add(subId); saveDone(n); } };
  const toggleSection = (si: number) => setExpanded((e) => { const n = new Set(e); if (n.has(si)) n.delete(si); else n.add(si); return n; });

  const embed = embedUrl(step.sub);
  // Scroll = vertical rendered slides; falls back to the embed when the deck
  // can't export (published id, or nothing linked).
  const showScroll = mode === "scroll" && canScrollDeck(step.sub);

  return (
    <div className="module-shell">
      <aside className="module-sidebar">
        <Link className="dash-back" href="/dashboard?section=modules">← Modules</Link>
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
          {/* Scroll / Slideshow toggle, top-right - only for Google files that
              can do both (a PDF is scroll-only; info is text-only). */}
          {(step.sub.kind === "slides" || step.sub.kind === "doc") && canScrollDeck(step.sub) && embed && (
            <div className="module-mode" role="tablist" aria-label="View mode">
              <button type="button" role="tab" aria-selected={mode === "scroll"} className={`module-mode-btn${mode === "scroll" ? " is-active" : ""}`} onClick={() => chooseMode("scroll")}>Scroll</button>
              <button type="button" role="tab" aria-selected={mode === "slideshow"} className={`module-mode-btn${mode === "slideshow" ? " is-active" : ""}`} onClick={() => chooseMode("slideshow")}>Slideshow</button>
            </div>
          )}
        </div>

        {!hasContent(step.sub) ? (
          <div className="module-embed-empty">
            <p className="module-embed-empty-title">Nothing here yet</p>
            <p className="dash-sub">An admin can add a Google Slides/Docs link, a PDF, or written info for this subsection in the module editor.</p>
          </div>
        ) : step.sub.kind === "info" ? (
          // Info: authored text, straight on the site (no file).
          <article className="module-info">
            {step.sub.body.split("\n").filter((line) => line.trim()).map((line, k) => (
              <p key={k} className="module-info-p">{line}</p>
            ))}
          </article>
        ) : step.sub.kind === "pdf" || showScroll ? (
          // Stacked, image-rendered pages (uploaded PDF, or a Google file's export).
          <div className="module-scroll-viewer">
            <SlidesScroll key={renderSource(step.sub)} id={renderSource(step.sub)} kind={step.sub.kind === "doc" ? "doc" : step.sub.kind === "pdf" ? "pdf" : "slides"} title={step.sub.title} />
          </div>
        ) : (
          <>
            {mode === "scroll" && (
              <p className="module-note">This deck is published-only, so the scroll view isn&apos;t available - showing the slideshow. Share it as a file (&quot;anyone with the link&quot;) to enable scroll.</p>
            )}
            <div className="module-embed-frame">
              <iframe className="module-embed" src={embed} title={step.sub.title} allowFullScreen allow="fullscreen" />
            </div>
          </>
        )}

        <div className="module-nav">
          <button type="button" className="btn" disabled={idx === 0} onClick={prev}>← Previous</button>
          <button type="button" className={`btn${done.has(step.sub.id) ? " primary" : ""}`} onClick={() => toggleDone(step.sub.id)}>
            {done.has(step.sub.id) ? "✓ Done" : "Mark done"}
          </button>
          {idx === steps.length - 1 ? (
            <Link className="cta" href="/dashboard?section=modules" onClick={() => markDone(step.sub.id)}>Finish</Link>
          ) : (
            <button type="button" className="cta" onClick={() => { markDone(step.sub.id); next(); }}>Next →</button>
          )}
        </div>

        <Comments type="module" target={mod.id} />
      </main>
    </div>
  );
}
