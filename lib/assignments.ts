/**
 * Assignments - the trainer/advisor -> student loop. Someone with a teaching
 * role hands a piece of content to a member; it shows up under "My assignments"
 * with a due date and a done/not-done state, and their trainer sees the
 * completion counts for the group.
 *
 * An assignment POINTS at content that already exists (a document, deck, quiz,
 * or module) rather than copying it, and denormalizes only the referenced
 * resource's title so a list render doesn't have to fan out to four stores.
 * The title is taken FROM the resource, never from the request body: those
 * titles were already moderated when the resource was created, so assigning
 * can't become an unmoderated free-text channel.
 *
 * WHO MAY DO WHAT is enforced in the API layer (app/api/assignments), matching
 * how the rest of the app splits store from policy. This module answers the two
 * ownership questions that are inherent to the record itself - only the
 * assignee may complete it, only the assigner (or an admin) may take it back.
 *
 * Demo-grade durable store like the others; a production build swaps in a DB.
 */

import { getDeck } from "./decks";
import { persistMap } from "./durable";
import { getModule } from "./modules";
import { getQuiz } from "./quizzes";
import type { Viewer } from "./visibility";

/** What an assignment can point at, one per content store. */
export type AssignmentKind = "doc" | "deck" | "quiz" | "module";
export type AssignmentStatus = "todo" | "done";

const KINDS: AssignmentKind[] = ["doc", "deck", "quiz", "module"];

export interface Assignment {
  id: string;
  kind: AssignmentKind;
  /** Id within the store named by `kind`. */
  refId: string;
  /** Denormalized title of the referenced resource, for list display. */
  title: string;
  /**
   * Which SECTIONS of the resource were assigned. Absent or empty means the
   * whole thing, which is what every assignment made before this field existed
   * means - so absent must keep reading as "all of it", never as "none of it".
   *
   * Only modules have sections, so only modules carry this. Titles are
   * denormalized for the same reason `title` is: a list render should not fan
   * out to the module store per row. They are resolved FROM the module and
   * never taken from the request, so a part label cannot become an
   * unmoderated free-text channel.
   */
  parts?: { id: string; title: string }[];
  assigneeId: string;
  assignedBy: string;
  assignedByName: string;
  /** The assignee's chapter at assign time - what scopes trainer/advisor oversight. */
  chapter: string;
  dueAt: number | null;
  status: AssignmentStatus;
  createdAt: number;
  completedAt: number | null;
}

export const TITLE_MAX = 120;
export const NAME_MAX = 80;
export const CHAPTER_MAX = 80;
export const ID_MAX = 128;
/** Ten years out - a due date past this is a typo or a bad clock, not a plan. */
export const DUE_MAX_AHEAD_MS = 10 * 365 * 24 * 60 * 60 * 1000;
/** Cap per member so a runaway loop can't grow the store without bound. */
export const MAX_PER_ASSIGNEE = 200;
/** Mirrors MAX_SECTIONS in lib/modules - a module cannot have more than this. */
export const MAX_PARTS = 40;

const g = globalThis as unknown as { __vitalsAssignments?: Map<string, Assignment> };
const store: Map<string, Assignment> = (g.__vitalsAssignments ??= new Map());
const { persist } = persistMap("assignments", store);

const clamp = (s: string, n: number) => String(s ?? "").trim().slice(0, n);

/** Whether an untrusted value names one of the four content stores. Exported so
 * the API layer can answer "unknown kind" (400) apart from "no such ref" (404). */
export function isAssignmentKind(v: unknown): v is AssignmentKind {
  return KINDS.includes(v as AssignmentKind);
}

/** A due date is optional; junk (NaN, a string, a date past DUE_MAX_AHEAD) is dropped. */
function cleanDue(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n > Date.now() + DUE_MAX_AHEAD_MS ? null : Math.floor(n);
}

/**
 * Look the referenced resource up in its own store and return its title, or
 * null when the kind is unknown or nothing has that id. This is what stops an
 * assignment from pointing at content that doesn't exist (or never did).
 *
 * Documents are fetched through a dynamic import: lib/store pulls in the seed
 * module, which imports lib/bootstrap - and bootstrap imports THIS module, so a
 * static import would close an evaluation-order cycle. Importing at call time
 * keeps the module graph acyclic.
 */
export async function resolveRef(kind: unknown, refId: unknown): Promise<{ kind: AssignmentKind; refId: string; title: string } | null> {
  if (!isAssignmentKind(kind)) return null;
  const id = clamp(String(refId ?? ""), ID_MAX);
  if (!id) return null;
  let title = "";
  if (kind === "doc") {
    const { getDoc } = await import("./store");
    title = (await getDoc(id))?.name ?? "";
  } else if (kind === "deck") {
    title = getDeck(id)?.title ?? "";
  } else if (kind === "quiz") {
    title = getQuiz(id)?.title ?? "";
  } else {
    title = getModule(id)?.title ?? "";
  }
  return title ? { kind, refId: id, title: clamp(title, TITLE_MAX) } : null;
}

/**
 * Turn section ids into {id, title} pairs by reading the module. Returns null
 * if ANY id is unknown: a stale id means the client is describing a module
 * that has since been edited, and quietly dropping it would assign less work
 * than the trainer just asked for without telling anyone.
 */
export function resolveParts(moduleId: string, ids: unknown): { id: string; title: string }[] | null {
  if (!Array.isArray(ids) || ids.length === 0) return null;
  const mod = getModule(clamp(String(moduleId ?? ""), ID_MAX));
  if (!mod) return null;
  const wanted = ids.slice(0, MAX_PARTS).map((v) => clamp(String(v ?? ""), ID_MAX));
  const out: { id: string; title: string }[] = [];
  for (const id of wanted) {
    const sec = mod.sections.find((x) => x.id === id);
    if (!sec) return null;
    out.push({ id: sec.id, title: clamp(sec.title, TITLE_MAX) });
  }
  // Section ORDER is the module's, not the order the boxes happened to be
  // ticked in - the student should read them the way the author sequenced them.
  const order = new Map(mod.sections.map((x, i) => [x.id, i]));
  out.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  // Every section selected is the whole module; storing it as a part list would
  // render as "3 of 3 parts" and imply a narrowing that isn't there.
  return out.length === mod.sections.length ? null : out;
}

export interface CreateAssignmentInput {
  kind: unknown;
  refId: unknown;
  assigneeId: string;
  assignedBy: string;
  assignedByName: string;
  /** The ASSIGNEE's chapter (resolved from the signed user directory). */
  chapter: string;
  dueAt?: unknown;
  /** Section ids to narrow a module assignment to. Omit for the whole thing. */
  parts?: unknown;
}

export type CreateAssignmentResult =
  | { ok: true; assignment: Assignment; duplicate: boolean }
  | { ok: false; error: "bad_ref" | "bad_assignee" | "limit" | "bad_parts" };

/** Identity of a parts selection, for the duplicate check. Null = whole thing. */
function partsKey(parts: { id: string }[] | null | undefined): string {
  return parts && parts.length ? parts.map((p) => p.id).join(",") : "*";
}

/**
 * Assign a resource to a member. Re-assigning something the member already has
 * OPEN returns the existing record (`duplicate: true`) instead of stacking a
 * second copy - a double-clicked Assign button shouldn't produce two rows.
 */
export async function createAssignment(input: CreateAssignmentInput): Promise<CreateAssignmentResult> {
  const assigneeId = clamp(input.assigneeId, ID_MAX);
  const assignedBy = clamp(input.assignedBy, ID_MAX);
  if (!assigneeId || !assignedBy) return { ok: false, error: "bad_assignee" };

  const ref = await resolveRef(input.kind, input.refId);
  if (!ref) return { ok: false, error: "bad_ref" };

  // Parts only narrow a module; nothing else has sections to narrow.
  const parts = ref.kind === "module" ? resolveParts(ref.refId, input.parts) : null;
  // Asked for specific parts and none of them resolved: refuse rather than
  // silently assign the whole module, which is more work than was asked for.
  if (ref.kind === "module" && Array.isArray(input.parts) && input.parts.length > 0 && parts === null) {
    // ...unless every section was picked, which resolveParts reports as "whole
    // module" by design. Distinguish the two before refusing.
    const mod = getModule(ref.refId);
    const all = mod ? input.parts.length === mod.sections.length : false;
    if (!all) return { ok: false, error: "bad_parts" };
  }

  const mine = listAssignmentsFor(assigneeId);
  // Two assignments of the same module differing only in which parts they
  // cover are NOT duplicates - "read section 2" after "read section 1" is a
  // second piece of work. Same parts (or both whole) still collapses.
  const key = partsKey(parts);
  const open = mine.find(
    (a) => a.status === "todo" && a.kind === ref.kind && a.refId === ref.refId && partsKey(a.parts ?? null) === key,
  );
  if (open) return { ok: true, assignment: open, duplicate: true };
  if (mine.length >= MAX_PER_ASSIGNEE) return { ok: false, error: "limit" };

  const assignment: Assignment = {
    id: `as_${crypto.randomUUID()}`,
    kind: ref.kind,
    refId: ref.refId,
    title: ref.title,
    assigneeId,
    assignedBy,
    assignedByName: clamp(input.assignedByName, NAME_MAX) || assignedBy,
    chapter: clamp(input.chapter, CHAPTER_MAX),
    dueAt: cleanDue(input.dueAt),
    ...(parts ? { parts } : {}),
    status: "todo",
    createdAt: Date.now(),
    completedAt: null,
  };
  store.set(assignment.id, assignment);
  persist();
  return { ok: true, assignment, duplicate: false };
}

export function getAssignment(id: string): Assignment | undefined {
  return store.get(clamp(id, ID_MAX));
}

/**
 * Newest first. The list arrives in insertion order, so reversing before a
 * (stable) sort makes assignments created in the SAME millisecond - a bulk
 * assign, or a fast test - order newest-first too, instead of flipping.
 * Mutates its argument, which is always a fresh array from the callers below.
 */
function newestFirst(items: Assignment[]): Assignment[] {
  return items.reverse().sort((a, b) => b.createdAt - a.createdAt);
}

/** One member's assignments, newest first - the "My assignments" list. */
export function listAssignmentsFor(assigneeId: string): Assignment[] {
  const id = clamp(assigneeId, ID_MAX);
  return newestFirst([...store.values()].filter((a) => a.assigneeId === id));
}

/**
 * Every assignment in one chapter, newest first - trainer/advisor oversight.
 * An empty chapter returns nothing on purpose: a viewer whose own chapter is
 * blank must not sweep up every other chapter-less member's work.
 */
export function listAssignmentsBy(chapter: string): Assignment[] {
  const c = clamp(chapter, CHAPTER_MAX);
  if (!c) return [];
  return newestFirst([...store.values()].filter((a) => a.chapter === c));
}

/** Every assignment, newest first - admin oversight only. */
export function listAllAssignments(): Assignment[] {
  return newestFirst([...store.values()]);
}

export type MutateResult =
  | { ok: true; assignment: Assignment }
  | { ok: false; error: "not_found" | "forbidden" };

/**
 * Set an assignment's status. Only the ASSIGNEE may - a trainer marking work
 * done for someone would make the roster's completion counts meaningless.
 *
 * Both directions, deliberately. Completion used to be one-way: a student who
 * ticked the wrong row, or who marked a module done and then found they had
 * more to do, had no way back and their trainer's progress count was wrong
 * with no way to correct it. Reopening clears completedAt rather than keeping
 * a stale timestamp on a row that is no longer done.
 */
export function setStatus(id: string, assigneeId: string, status: AssignmentStatus): MutateResult {
  const a = getAssignment(id);
  if (!a) return { ok: false, error: "not_found" };
  if (a.assigneeId !== clamp(assigneeId, ID_MAX)) return { ok: false, error: "forbidden" };
  if (a.status !== status) {
    a.status = status;
    a.completedAt = status === "done" ? Date.now() : null;
    persist();
  }
  return { ok: true, assignment: a };
}

/** Complete an assignment. Thin alias kept for existing callers. */
export function markDone(id: string, assigneeId: string): MutateResult {
  return setStatus(id, assigneeId, "done");
}

/** Take an assignment back. Only whoever assigned it, or any admin. */
export function unassign(id: string, byViewer: Pick<Viewer, "owner" | "admin">): MutateResult {
  const a = getAssignment(id);
  if (!a) return { ok: false, error: "not_found" };
  if (!byViewer.admin && a.assignedBy !== byViewer.owner) return { ok: false, error: "forbidden" };
  store.delete(a.id);
  persist();
  return { ok: true, assignment: a };
}

export interface CompletionStat {
  assigned: number;
  done: number;
}

/**
 * Assigned/done counts per member, for the roster's progress column. Every id
 * asked for comes back (zeroed when they have nothing), so the caller can map
 * straight over its roster without holes.
 */
export function completionStats(assigneeIds: string[]): Record<string, CompletionStat> {
  const out: Record<string, CompletionStat> = {};
  for (const raw of assigneeIds) out[clamp(raw, ID_MAX)] = { assigned: 0, done: 0 };
  for (const a of store.values()) {
    const stat = out[a.assigneeId];
    if (!stat) continue;
    stat.assigned += 1;
    if (a.status === "done") stat.done += 1;
  }
  return out;
}

/** Test-only: empty the store. */
export function __resetAssignments(): void {
  store.clear();
}
