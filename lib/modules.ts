/**
 * Learning modules - the real HOSA modules are Google Slides decks, so a module
 * is a set of Sections; each Section has Subsections; and each Subsection embeds
 * one Google Slides presentation. The left nav lists sections (collapsible) and
 * their subsections; the stage embeds the current subsection's deck. Completion
 * is tracked per subsection ("mark as done") and the progress bar reflects
 * subsections completed.
 *
 * Demo-grade durable store like the others; a production build swaps in a DB.
 */

import { persistMap } from "./durable";

/**
 * What backs a subsection:
 *  - "slides"/"doc": a Google Slides / Docs file (export to PDF -> stacked image
 *    scroll view, or the interactive embed/preview).
 *  - "pdf": an uploaded PDF (its stored bytes rendered to stacked images).
 *  - "info": authored text shown directly on the site (no file).
 */
export type SubKind = "slides" | "doc" | "pdf" | "info";
/** The two file kinds that live in Google and export to PDF via a URL. */
export type GoogleKind = "slides" | "doc";

export interface Subsection {
  id: string;
  title: string;
  kind: SubKind;
  /** Google file id (kind slides/doc), "" otherwise. */
  slidesId: string;
  /** Published /d/e/<id> (embed only, no PDF export) - kind slides/doc. */
  slidesPub: boolean;
  /** Uploaded document id (kind pdf), "" otherwise. */
  docId: string;
  /** Authored text (kind info), "" otherwise. */
  body: string;
}

/** Parse a pasted Google Slides / Docs link (or bare id) into id + kind + pub.
 * Returns null for anything that isn't a Google Slides/Docs reference. */
export function parseSlides(input: unknown): { id: string; kind: GoogleKind; pub: boolean } | null {
  const s = String(input ?? "").trim().slice(0, 600);
  if (!s) return null;
  if (/^[A-Za-z0-9_-]{20,}$/.test(s)) return { id: s, kind: "slides", pub: false }; // bare id -> assume slides
  if (!/^https:\/\/docs\.google\.com\//.test(s)) return null; // never trust another origin
  for (const [type, kind] of [["presentation", "slides"], ["document", "doc"]] as const) {
    const pub = s.match(new RegExp(`/${type}/d/e/([A-Za-z0-9_-]+)`));
    if (pub) return { id: pub[1]!, kind, pub: true };
    const file = s.match(new RegExp(`/${type}/d/([A-Za-z0-9_-]+)`));
    if (file) return { id: file[1]!, kind, pub: false };
  }
  return null;
}

/** The interactive embed / preview URL for a Google subsection (or "" otherwise). */
export function embedUrlFor(sub: Pick<Subsection, "kind" | "slidesId" | "slidesPub">): string {
  if (!sub.slidesId || (sub.kind !== "slides" && sub.kind !== "doc")) return "";
  const e = sub.slidesPub ? "e/" : "";
  return sub.kind === "doc"
    ? `https://docs.google.com/document/d/${e}${sub.slidesId}/${sub.slidesPub ? "pub" : "preview"}`
    : `https://docs.google.com/presentation/d/${e}${sub.slidesId}/embed`;
}

/** The PDF-export URL for a Google file (used by the scroll renderer). */
export function exportPdfUrl(id: string, kind: GoogleKind): string {
  return kind === "doc"
    ? `https://docs.google.com/document/d/${id}/export?format=pdf`
    : `https://docs.google.com/presentation/d/${id}/export/pdf`;
}

/** True when a subsection has usable content (so it counts toward progress). */
export function subHasContent(sub: Subsection): boolean {
  if (sub.kind === "info") return Boolean(sub.body.trim());
  if (sub.kind === "pdf") return Boolean(sub.docId);
  return Boolean(sub.slidesId);
}

export interface Section {
  id: string;
  title: string;
  subsections: Subsection[];
}

export interface Module {
  id: string;
  title: string;
  summary?: string;
  sections: Section[];
  owner: string;
  createdAt: number;
}

export interface ModuleMeta {
  id: string;
  title: string;
  summary?: string;
  sectionCount: number;
  subsectionCount: number;
  /** How many subsections actually have a Google Slides deck linked. */
  linkedCount: number;
  owner: string;
  createdAt: number;
}

export const TITLE_MAX = 120;
export const SUMMARY_MAX = 240;
export const BODY_MAX = 10000;
export const URL_MAX = 600;
export const MAX_SECTIONS = 40;
export const MAX_SUBSECTIONS = 60;

const g = globalThis as unknown as { __vitalsModules?: Map<string, Module> };
const store: Map<string, Module> = (g.__vitalsModules ??= new Map());
const { persist } = persistMap("modules", store);

const clamp = (s: string, n: number) => String(s ?? "").trim().slice(0, n);
const countSubsections = (m: Module) => m.sections.reduce((n, s) => n + s.subsections.length, 0);
const countLinked = (m: Module) => m.sections.reduce((n, s) => n + s.subsections.filter(subHasContent).length, 0);

// Seed one sample module. The subsections point at a real link-shared Google
// Slides FILE (supports both the interactive embed and /export/pdf, so the
// scroll view works) as an example - admins replace it with the real HOSA decks.
const EX_ID = "1mqpmJncmRnmaijkiGl67KXWzISfIdPNocYQarsbL2NY";
if (!store.has("sample-module")) {
  const sub = (id: string, title: string): Subsection => ({ id, title, kind: "slides", slidesId: EX_ID, slidesPub: false, docId: "", body: "" });
  store.set("sample-module", {
    id: "sample-module",
    title: "EMT Fundamentals",
    summary: "The core round-1 material: scene safety, assessment, and vitals.",
    owner: "system",
    createdAt: 0,
    sections: [
      { id: "sec1", title: "Scene Safety", subsections: [sub("ss1", "Sizing up the scene"), sub("ss2", "Standard precautions")] },
      { id: "sec2", title: "Patient Assessment", subsections: [sub("ss3", "Primary survey"), sub("ss4", "History taking")] },
      { id: "sec3", title: "Vital Signs", subsections: [sub("ss5", "What to measure"), sub("ss6", "Normal adult ranges")] },
    ],
  });
}

export function listModules(): ModuleMeta[] {
  return [...store.values()]
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((m) => ({
      id: m.id,
      title: m.title,
      ...(m.summary ? { summary: m.summary } : {}),
      sectionCount: m.sections.length,
      subsectionCount: countSubsections(m),
      linkedCount: countLinked(m),
      owner: m.owner,
      createdAt: m.createdAt,
    }));
}

/**
 * True if some module subsection references this uploaded doc id. Gates PDF
 * rendering: only module-linked uploads are renderable through the module image
 * endpoint - never an arbitrary (possibly private) user upload.
 */
export function isModuleDoc(docId: string): boolean {
  if (!docId) return false;
  for (const m of store.values())
    for (const s of m.sections)
      for (const ss of s.subsections)
        if (ss.kind === "pdf" && ss.docId === docId) return true;
  return false;
}

export function getModule(id: string): Module | undefined {
  return store.get(id);
}

/** Normalize raw sections/subsections from a client into the stored shape. */
function cleanSections(raw: unknown): Section[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, MAX_SECTIONS).map((s, i) => {
    const sec = s as { id?: unknown; title?: unknown; subsections?: unknown };
    const secId = typeof sec.id === "string" && sec.id ? sec.id : `sec${i}_${crypto.randomUUID().slice(0, 6)}`;
    const subs = Array.isArray(sec.subsections) ? sec.subsections : [];
    return {
      id: secId,
      title: clamp(String(sec.title ?? ""), TITLE_MAX) || `Section ${i + 1}`,
      subsections: subs.slice(0, MAX_SUBSECTIONS).map((ss, j) => {
        const sub = ss as { id?: unknown; title?: unknown; kind?: unknown; slides?: unknown; slidesId?: unknown; docId?: unknown; body?: unknown };
        const id = typeof sub.id === "string" && sub.id ? sub.id : `${secId}_ss${j}_${crypto.randomUUID().slice(0, 6)}`;
        const title = clamp(String(sub.title ?? ""), TITLE_MAX) || `Part ${j + 1}`;
        const base = { id, title, slidesId: "", slidesPub: false, docId: "", body: "" };
        const kindIn = String(sub.kind ?? "");
        if (kindIn === "info") {
          return { ...base, kind: "info" as const, body: clamp(String(sub.body ?? ""), BODY_MAX) };
        }
        if (kindIn === "pdf") {
          // Same charset/length the render endpoint accepts, so a stored docId
          // is never one the renderer would reject as bad_id.
          const docId = /^[A-Za-z0-9_-]{10,120}$/.test(String(sub.docId ?? "")) ? String(sub.docId) : "";
          return { ...base, kind: "pdf" as const, docId };
        }
        // Google (slides/doc): accept a pasted link/id (`slides`) or preserved id.
        const parsed = parseSlides(sub.slides ?? sub.slidesId);
        return { ...base, kind: parsed?.kind ?? "slides", slidesId: parsed?.id ?? "", slidesPub: parsed?.pub ?? false };
      }),
    };
  });
}

export function createModule(title: string, owner: string, opts?: { summary?: string; sections?: unknown }): Module {
  const mod: Module = {
    id: `m_${crypto.randomUUID()}`,
    title: clamp(title, TITLE_MAX) || "Untitled module",
    ...(opts?.summary ? { summary: clamp(opts.summary, SUMMARY_MAX) } : {}),
    sections: cleanSections(opts?.sections),
    owner,
    createdAt: Date.now(),
  };
  store.set(mod.id, mod);
  persist();
  return mod;
}

export function updateModule(id: string, patch: { title?: string; summary?: string; sections?: unknown }): Module | undefined {
  if (id === "sample-module") return undefined;
  const mod = store.get(id);
  if (!mod) return undefined;
  if (patch.title !== undefined) mod.title = clamp(patch.title, TITLE_MAX) || "Untitled module";
  if (patch.summary !== undefined) mod.summary = clamp(patch.summary, SUMMARY_MAX) || undefined;
  if (patch.sections !== undefined) mod.sections = cleanSections(patch.sections);
  persist();
  return mod;
}

export function deleteModule(id: string): boolean {
  if (id === "sample-module") return false;
  const ok = store.delete(id);
  if (ok) persist();
  return ok;
}

export function __resetModules(): void {
  store.clear();
}
