/**
 * Learning modules - the real HOSA modules are Google Slides decks, so a module
 * is a set of Sections; each Section has Subsections ("parts"); and each part
 * holds an ORDERED LIST OF BLOCKS. A block is one artifact - a Google deck, an
 * uploaded PDF, or a written note - so an author can embed the deck, attach the
 * worksheet underneath it, and put a paragraph of context above both, all in
 * one part. The left nav lists sections (collapsible) and their parts; the
 * stage renders the current part's blocks top to bottom.
 *
 * Completion is still tracked per PART ("mark as done") and the progress bar
 * still reflects parts completed - blocks are content, not progress. Study
 * progress is keyed on subsection ids, so those ids survive migration untouched.
 *
 * Demo-grade durable store like the others; a production build swaps in a DB.
 */

import { persistMap } from "./durable";

/**
 * What one block holds:
 *  - "slides"/"doc": a Google Slides / Docs file (export to PDF -> stacked image
 *    scroll view, or the interactive embed/preview).
 *  - "pdf": an uploaded PDF (its stored bytes rendered to stacked images).
 *  - "info": authored Markdown shown directly on the site (no file).
 */
export type BlockKind = "slides" | "doc" | "pdf" | "info";
/** The two file kinds that live in Google and export to PDF via a URL. */
export type GoogleKind = "slides" | "doc";

/** A Google Slides / Docs file. */
export interface GoogleBlock {
  id: string;
  kind: GoogleKind;
  /** Google file id, or "" while the author hasn't pasted a link yet. */
  slidesId: string;
  /** Published /d/e/<id> (embed only, no PDF export). */
  slidesPub: boolean;
}
/** An uploaded PDF, referenced by its upload id. */
export interface PdfBlock {
  id: string;
  kind: "pdf";
  docId: string;
}
/** Text the author wrote on the site (Markdown), backed by no file. */
export interface InfoBlock {
  id: string;
  kind: "info";
  body: string;
}
/**
 * A discriminated union, not one flat record with every payload set to "":
 * `kind` then tells the compiler which fields exist, so nothing can read `body`
 * off a PDF. The EDITOR deliberately keeps a flat shape instead - see the note
 * on its own block type - because switching a block's kind mid-edit must not
 * throw away what you already typed under the other one.
 */
export type Block = GoogleBlock | PdfBlock | InfoBlock;

export interface Subsection {
  id: string;
  title: string;
  /** Rendered top to bottom in this order. Empty means a part with nothing in it yet. */
  blocks: Block[];
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

/** True for the two block kinds that point at a Google file. */
export function isGoogleBlock(b: Block): b is GoogleBlock {
  return b.kind === "slides" || b.kind === "doc";
}

/** The interactive embed / preview URL for a block (or "" for anything else). */
export function embedUrlFor(block: Block): string {
  if (!isGoogleBlock(block) || !block.slidesId) return "";
  const e = block.slidesPub ? "e/" : "";
  return block.kind === "doc"
    ? `https://docs.google.com/document/d/${e}${block.slidesId}/${block.slidesPub ? "pub" : "preview"}`
    : `https://docs.google.com/presentation/d/${e}${block.slidesId}/embed`;
}

/** The PDF-export URL for a Google file (used by the scroll renderer). */
export function exportPdfUrl(id: string, kind: GoogleKind): string {
  return kind === "doc"
    ? `https://docs.google.com/document/d/${id}/export?format=pdf`
    : `https://docs.google.com/presentation/d/${id}/export/pdf`;
}

/** True when a block actually points at something (so it renders, and counts). */
export function blockHasContent(block: Block): boolean {
  if (block.kind === "info") return Boolean(block.body.trim());
  if (block.kind === "pdf") return Boolean(block.docId);
  return Boolean(block.slidesId);
}

/** True when a part has usable content (so it counts toward progress). */
export function subHasContent(sub: Subsection): boolean {
  return (sub.blocks ?? []).some(blockHasContent);
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
  /** How many subsections have at least one block with content in them. */
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
export const MAX_BLOCKS = 20;

/**
 * The Google file-id charset, for an id read back out of storage rather than
 * parsed from a pasted link. Restricted to what can only ever be one path
 * segment on docs.google.com, so a tampered snapshot can't smuggle a different
 * URL into an iframe. Deliberately more permissive on length than parseSlides'
 * bare-id rule: published /d/e/ ids are short, and one must survive a re-read.
 */
const GOOGLE_ID = /^[A-Za-z0-9_-]{8,200}$/;
/** Same charset/length the render endpoint accepts, so a stored docId is never
 * one the renderer would reject as bad_id. */
const UPLOAD_ID = /^[A-Za-z0-9_-]{10,120}$/;

const g = globalThis as unknown as { __vitalsModules?: Map<string, Module> };
const store: Map<string, Module> = (g.__vitalsModules ??= new Map());
const { persist } = persistMap("modules", store);

const clamp = (s: string, n: number) => String(s ?? "").trim().slice(0, n);
const countSubsections = (m: Module) => m.sections.reduce((n, s) => n + s.subsections.length, 0);
const countLinked = (m: Module) => m.sections.reduce((n, s) => n + s.subsections.filter(subHasContent).length, 0);

// Seed one sample module. Its parts point at a real link-shared Google Slides
// FILE (supports both the interactive embed and /export/pdf, so the scroll view
// works) as an example - admins replace it with the real HOSA decks.
const EX_ID = "1mqpmJncmRnmaijkiGl67KXWzISfIdPNocYQarsbL2NY";
if (!store.has("sample-module")) {
  const sub = (id: string, title: string): Subsection => ({
    id,
    title,
    blocks: [{ id: `${id}_b0`, kind: "slides", slidesId: EX_ID, slidesPub: false }],
  });
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

/* -------------------------------------------------------------- normalizing */

/**
 * One block from raw input, or null if it isn't a block we render.
 *
 * The same function serves both inbound directions - a client PATCH and a
 * legacy snapshot row - because the two carry the same fields; a migrated part
 * therefore gets exactly the validation a freshly authored one does, instead of
 * a second, laxer path that only old data travels. An unknown kind is DROPPED
 * rather than coerced: storing a block nothing knows how to render would leave
 * the author with an invisible, unremovable part of their module.
 */
function cleanBlock(raw: unknown, fallbackId: string): Block | null {
  if (!raw || typeof raw !== "object") return null;
  const b = raw as {
    id?: unknown; kind?: unknown; slides?: unknown; slidesId?: unknown;
    slidesPub?: unknown; docId?: unknown; body?: unknown;
  };
  const id = typeof b.id === "string" && b.id ? b.id.slice(0, 80) : fallbackId;
  const kind = String(b.kind ?? "");

  if (kind === "info") return { id, kind: "info", body: clamp(String(b.body ?? ""), BODY_MAX) };
  if (kind === "pdf") {
    const docId = String(b.docId ?? "");
    return { id, kind: "pdf", docId: UPLOAD_ID.test(docId) ? docId : "" };
  }
  // "google" is what the editor called this before slides and doc were separate
  // block kinds; an editor tab left open across a deploy still sends it.
  // An absent kind is the pre-blocks default (a part was a deck unless told
  // otherwise), so it lands here too.
  if (kind !== "slides" && kind !== "doc" && kind !== "google" && kind !== "") return null;

  // A pasted link names the file type; a bare id does not (parseSlides has to
  // guess "slides" for one), so a stored id keeps the kind the block declared.
  const link = clamp(String(b.slides ?? ""), URL_MAX);
  const pasted = link ? parseSlides(link) : null;
  if (pasted) return { id, kind: pasted.kind, slidesId: pasted.id, slidesPub: pasted.pub };
  const stored = String(b.slidesId ?? "");
  return {
    id,
    kind: kind === "doc" ? "doc" : "slides",
    slidesId: GOOGLE_ID.test(stored) ? stored : "",
    slidesPub: b.slidesPub === true,
  };
}

/** A blocks array from raw input. A non-array is rejected outright, not guessed at. */
function cleanBlocks(raw: unknown, subId: string): Block[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(0, MAX_BLOCKS)
    .map((b, k) => cleanBlock(b, `${subId}_b${k}`))
    .filter((b): b is Block => b !== null);
}

/**
 * MIGRATION. Before blocks, a part WAS its single artifact: kind + slidesId +
 * slidesPub + docId + body sat on the subsection itself. That record is
 * structurally already a block, so an old part becomes a one-block part by
 * handing the subsection to cleanBlock unchanged - the payload lands in the
 * block it belongs to, and nothing an author wrote is lost.
 *
 * A MISSING `blocks` field is what identifies the old shape. A present-but-wrong
 * one (a client sending `blocks: "x"`) is bad input, not an old record, and is
 * rejected to an empty list rather than silently re-read as a legacy part.
 */
function cleanSubsection(raw: unknown, fallbackId: string, index: number): Subsection {
  const ss = (raw && typeof raw === "object" ? raw : {}) as { id?: unknown; title?: unknown; blocks?: unknown };
  const id = typeof ss.id === "string" && ss.id ? ss.id : fallbackId;
  // The part's own id is held back: the block gets a derived one, so a block id
  // and the subsection id it lives under never read as the same thing. It is
  // derived rather than random so re-migrating the same row twice is stable.
  const legacy = ss.blocks === undefined ? cleanBlock({ ...ss, id: undefined }, `${id}_b0`) : null;
  return {
    id,
    title: clamp(String(ss.title ?? ""), TITLE_MAX) || `Part ${index + 1}`,
    blocks: ss.blocks === undefined ? (legacy ? [legacy] : []) : cleanBlocks(ss.blocks, id),
  };
}

/** Normalize raw sections/subsections (client input, or a stored snapshot). */
function cleanSections(raw: unknown): Section[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, MAX_SECTIONS).map((s, i) => {
    const sec = s as { id?: unknown; title?: unknown; subsections?: unknown };
    const secId = typeof sec.id === "string" && sec.id ? sec.id : `sec${i}_${crypto.randomUUID().slice(0, 6)}`;
    const subs = Array.isArray(sec.subsections) ? sec.subsections : [];
    return {
      id: secId,
      title: clamp(String(sec.title ?? ""), TITLE_MAX) || `Section ${i + 1}`,
      subsections: subs
        .slice(0, MAX_SUBSECTIONS)
        .map((ss, j) => cleanSubsection(ss, `${secId}_ss${j}_${crypto.randomUUID().slice(0, 6)}`, j)),
    };
  });
}

/**
 * Read a module out of the store in the CURRENT shape.
 *
 * Migration happens HERE, at the read boundary, so no caller ever sees the old
 * shape and a snapshot holding BOTH at once - which is what a rollout looks
 * like - reads correctly row by row.
 *
 * We also migrate on WRITE (cleanSections only ever emits blocks) rather than
 * maintaining both shapes forever. Keeping both would mean two answers to "what
 * is in this part" with no rule for which wins the moment an author adds a
 * second block, and every future reader would have to know the old model. The
 * cost is that the old fields disappear from a module's row the first time it
 * is saved; the benefit is that this function is the only code that will ever
 * need to know they existed, and it can be deleted once no legacy rows remain.
 *
 * The upgrade is applied to the in-memory copy too. That is not a disk write:
 * it just means the store converges as modules are read, and the next persist()
 * from any write carries the finished shape out.
 */
function read(id: string): Module | undefined {
  const mod = store.get(id);
  if (!mod) return undefined;
  const current = mod.sections?.every((s) =>
    (s.subsections ?? []).every((ss) => Array.isArray((ss as { blocks?: unknown }).blocks)),
  );
  if (current) return mod;
  const upgraded = { ...mod, sections: cleanSections(mod.sections) };
  store.set(id, upgraded);
  return upgraded;
}

/* ------------------------------------------------------------------ reading */

export function listModules(): ModuleMeta[] {
  return [...store.keys()]
    .map((id) => read(id)!)
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
 * True if some module block references this uploaded doc id. Gates PDF
 * rendering: only module-linked uploads are renderable through the module image
 * endpoint - never an arbitrary (possibly private) user upload.
 */
export function isModuleDoc(docId: string): boolean {
  if (!docId) return false;
  for (const id of [...store.keys()]) {
    const m = read(id);
    if (!m) continue;
    for (const s of m.sections)
      for (const ss of s.subsections)
        for (const b of ss.blocks)
          if (b.kind === "pdf" && b.docId === docId) return true;
  }
  return false;
}

export function getModule(id: string): Module | undefined {
  return read(id);
}

/* ------------------------------------------------------------------ writing */

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
  const mod = read(id);
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

/**
 * Test-only: plant a row into the store exactly as hydration would, bypassing
 * cleanSections. The point is to stand up a snapshot written by an OLDER build -
 * the one case createModule can no longer produce, and the one the read boundary
 * exists for.
 */
export function __seedSnapshotRow(id: string, row: unknown): void {
  store.set(id, row as Module);
}
