/**
 * Member feedback / bug reports.
 *
 * Anyone can file a report (bug, idea, or other); admins review and resolve
 * them. Deliberately NOT moderated - a bug report may legitimately be blunt or
 * frustrated, and silently blocking it would lose the signal. Durable via the
 * same snapshot layer as the other stores.
 */

import { isHydrated, registerHydrator } from "./durable";
import { loadSnapshot, saveSnapshot } from "./persist";

export type FeedbackKind = "bug" | "idea" | "other";
const VALID_KINDS: readonly FeedbackKind[] = ["bug", "idea", "other"];

export interface Feedback {
  id: string;
  kind: FeedbackKind;
  message: string;
  /** Where the reporter was (e.g. "/dashboard?section=modules"), if provided. */
  page?: string;
  reporter: string;
  at: number;
  resolved: boolean;
}

const CAP = 500;
const MSG_MAX = 2000;
const PAGE_MAX = 200;

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

/** File a report. Returns null if the message is empty after trimming. */
export function submitFeedback(input: { kind: unknown; message: unknown; page?: unknown; reporter: string }): Feedback | null {
  const message = String(input.message ?? "").trim().slice(0, MSG_MAX);
  if (!message) return null;
  const page = input.page ? String(input.page).slice(0, PAGE_MAX) : undefined;
  const item: Feedback = {
    id: `fb_${crypto.randomUUID()}`,
    kind: normalizeKind(input.kind),
    message,
    ...(page ? { page } : {}),
    reporter: input.reporter,
    at: Date.now(),
    resolved: false,
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
