/**
 * Member feedback / bug reports.
 *
 * Anyone can file a report (bug, idea, or other); admins review and resolve
 * them. Deliberately NOT moderated - a bug report may legitimately be blunt or
 * frustrated, and silently blocking it would lose the signal. Durable via the
 * same snapshot layer as the other stores.
 *
 * A report may name the content it is about (a module, doc or quiz) so an admin
 * can see every complaint against one thing at once. That attachment is always
 * OPTIONAL and always secondary: a report with a broken target still files as a
 * general one, because the student's message is the part we cannot afford to
 * lose. Reports written before targets existed have none and keep working.
 */

import { isHydrated, registerHydrator } from "./durable";
import { loadSnapshot, saveSnapshot } from "./persist";

export type FeedbackKind = "bug" | "idea" | "other";
const VALID_KINDS: readonly FeedbackKind[] = ["bug", "idea", "other"];

export type FeedbackTargetKind = "module" | "doc" | "quiz";
const VALID_TARGET_KINDS: readonly FeedbackTargetKind[] = ["module", "doc", "quiz"];

export interface FeedbackTarget {
  kind: FeedbackTargetKind;
  id: string;
  /** Title snapshotted when the report is filed. */
  title: string;
  /** 1-based question number; only meaningful for a quiz. */
  question?: number;
}

export interface Feedback {
  id: string;
  kind: FeedbackKind;
  message: string;
  /** Where the reporter was (e.g. "/dashboard?section=modules"), if provided. */
  page?: string;
  reporter: string;
  at: number;
  resolved: boolean;
  /** The content this report is about. Absent means a general report. */
  target?: FeedbackTarget;
}

const CAP = 500;
const MSG_MAX = 2000;
const PAGE_MAX = 200;
const TARGET_ID_MAX = 200;
const TARGET_TITLE_MAX = 200;
// No real quiz has a thousand questions; past that the number is a bug, not a
// question an admin could go look at.
const QUESTION_MAX = 999;

// A newest-first ring buffer (array, like the audit log), persisted as a JSON
// snapshot. Survives hot reloads / warm instances via globalThis.
const g = globalThis as unknown as { __vitalsFeedback?: Feedback[] };
const log: Feedback[] = (g.__vitalsFeedback ??= []);

registerHydrator(async () => {
  const snap = await loadSnapshot<Feedback[]>("feedback");
  if (snap) {
    log.length = 0;
    log.push(...snap);
  }
});

function persist(): void {
  if (isHydrated()) saveSnapshot("feedback", log);
}

export function normalizeKind(raw: unknown): FeedbackKind {
  return typeof raw === "string" && (VALID_KINDS as readonly string[]).includes(raw) ? (raw as FeedbackKind) : "other";
}

/** Narrow a query string / request field to a target kind we can look up. */
export function isFeedbackTargetKind(raw: unknown): raw is FeedbackTargetKind {
  return typeof raw === "string" && (VALID_TARGET_KINDS as readonly string[]).includes(raw);
}

/** Trim + cap an id the same way on the write and the read, so a stored id is findable. */
function clampId(raw: unknown): string {
  return String(raw ?? "").trim().slice(0, TARGET_ID_MAX);
}

/**
 * A target we can actually act on, or undefined.
 *
 * Undefined means "file this as a general report", never "reject the report" -
 * see the module note. Unlike normalizeKind there is no "other" bucket to fall
 * back to: a report attached to a kind we don't understand, or to an id an
 * admin can't resolve, would send them looking for content that isn't there.
 */
export function normalizeTarget(raw: unknown): FeedbackTarget | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const t = raw as Record<string, unknown>;
  if (!isFeedbackTargetKind(t.kind)) return undefined;
  const id = clampId(t.id);
  if (!id) return undefined;
  // The title is snapshotted rather than looked up later on purpose: content
  // gets renamed and deleted, and a report an admin can't identify is useless.
  // A blank title would leave exactly that dangling id, so it drops the target.
  const title = String(t.title ?? "").trim().slice(0, TARGET_TITLE_MAX);
  if (!title) return undefined;
  const question = normalizeQuestion(t.question, t.kind);
  return { kind: t.kind, id, title, ...(question ? { question } : {}) };
}

/**
 * A question number is context, so a bad one is dropped while the target and
 * the message survive. It is NOT clamped into range: rounding 0 or 4.5 up to a
 * real question number would point the admin at a question nobody reported,
 * which is worse than pointing them at the quiz as a whole.
 */
function normalizeQuestion(raw: unknown, kind: FeedbackTargetKind): number | undefined {
  if (kind !== "quiz") return undefined; // meaningless anywhere else; don't store noise
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
  if (!Number.isInteger(n) || n < 1 || n > QUESTION_MAX) return undefined;
  return n;
}

/** File a report. Returns null if the message is empty after trimming. */
export function submitFeedback(input: {
  kind: unknown;
  message: unknown;
  page?: unknown;
  target?: unknown;
  reporter: string;
}): Feedback | null {
  const message = String(input.message ?? "").trim().slice(0, MSG_MAX);
  if (!message) return null;
  const page = input.page ? String(input.page).slice(0, PAGE_MAX) : undefined;
  const target = normalizeTarget(input.target);
  const item: Feedback = {
    id: `fb_${crypto.randomUUID()}`,
    kind: normalizeKind(input.kind),
    message,
    ...(page ? { page } : {}),
    reporter: input.reporter,
    at: Date.now(),
    resolved: false,
    ...(target ? { target } : {}),
  };
  log.unshift(item);
  if (log.length > CAP) log.length = CAP;
  persist();
  return item;
}

/** All reports, newest-first. */
export function listFeedback(): Feedback[] {
  return [...log];
}

/**
 * Reports against one piece of content, newest first.
 *
 * The id is clamped exactly as it was on the way in, so an admin pasting an id
 * with stray whitespace finds the same rows the reporter created. An id that
 * clamps to empty matches nothing rather than everything - a filter that
 * quietly widens would read as "these are all the reports about this module".
 */
export function listFeedbackFor(kind: FeedbackTargetKind, id: string): Feedback[] {
  const wanted = clampId(id);
  if (!wanted) return [];
  return log.filter((f) => f.target?.kind === kind && f.target.id === wanted);
}

/** Mark a report resolved / reopened (admin). */
export function setResolved(id: string, resolved: boolean): Feedback | undefined {
  const item = log.find((f) => f.id === id);
  if (!item) return undefined;
  item.resolved = resolved;
  persist();
  return item;
}

/** Test-only reset. */
export function __resetFeedback(): void {
  log.length = 0;
}
