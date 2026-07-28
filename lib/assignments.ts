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

export interface CreateAssignmentInput {
  kind: unknown;
  refId: unknown;
  assigneeId: string;
  assignedBy: string;
  assignedByName: string;
  /** The ASSIGNEE's chapter (resolved from the signed user directory). */
  chapter: string;
  dueAt?: unknown;
}

export type CreateAssignmentResult =
  | { ok: true; assignment: Assignment; duplicate: boolean }
  | { ok: false; error: "bad_ref" | "bad_assignee" | "limit" };

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

  const mine = listAssignmentsFor(assigneeId);
  const open = mine.find((a) => a.status === "todo" && a.kind === ref.kind && a.refId === ref.refId);
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

/** Complete an assignment. Only the assignee may - a trainer can't self-mark it. */
export function markDone(id: string, assigneeId: string): MutateResult {
  const a = getAssignment(id);
  if (!a) return { ok: false, error: "not_found" };
  if (a.assigneeId !== clamp(assigneeId, ID_MAX)) return { ok: false, error: "forbidden" };
  if (a.status !== "done") {
    a.status = "done";
    a.completedAt = Date.now();
    persist();
  }
  return { ok: true, assignment: a };
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
