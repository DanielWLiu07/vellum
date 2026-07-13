/**
 * Comments on resources and modules.
 *
 * A lightweight, flat discussion thread attached to a target (a document/resource
 * or a module). Members can post and delete their own; admins can delete any.
 * Text is moderated at the route before it lands here. Durable via the same
 * snapshot layer as the other stores.
 */

import { isHydrated, registerHydrator } from "./durable";
import { loadSnapshot, saveSnapshot } from "./persist";

export type CommentTarget = "doc" | "module";

export interface Comment {
  id: string;
  targetType: CommentTarget;
  targetId: string;
  author: string;
  body: string;
  at: number;
}

const CAP = 2000;
const PER_TARGET_CAP = 300;
export const BODY_MAX = 1500;

const g = globalThis as unknown as { __vitalsComments?: Comment[] };
const log: Comment[] = (g.__vitalsComments ??= []);

registerHydrator(async () => {
  const snap = await loadSnapshot<Comment[]>("comments");
  if (snap) { log.length = 0; log.push(...snap); }
});

function persist(): void {
  if (isHydrated()) saveSnapshot("comments", log);
}

/** Add a comment. Returns null if the body is empty after trimming. */
export function addComment(input: { targetType: CommentTarget; targetId: string; author: string; body: string }): Comment | null {
  const body = String(input.body ?? "").trim().slice(0, BODY_MAX);
  if (!body) return null;
  const c: Comment = {
    id: `c_${crypto.randomUUID()}`,
    targetType: input.targetType,
    targetId: String(input.targetId).slice(0, 80),
    author: input.author,
    body,
    at: Date.now(),
  };
  log.unshift(c);
  // Bound per-target so one thread can't grow without limit, then the global cap.
  const same = log.filter((x) => x.targetType === c.targetType && x.targetId === c.targetId);
  if (same.length > PER_TARGET_CAP) {
    const drop = same[same.length - 1];
    const idx = log.indexOf(drop!);
    if (idx >= 0) log.splice(idx, 1);
  }
  if (log.length > CAP) log.length = CAP;
  persist();
  return c;
}

/** Comments for one target, oldest-first (natural reading order). The log is
 * newest-first (unshift), so reversing the filtered slice gives a stable
 * oldest-first order even when timestamps tie in the same millisecond. */
export function listComments(targetType: CommentTarget, targetId: string): Comment[] {
  return log.filter((c) => c.targetType === targetType && c.targetId === targetId).reverse();
}

/** Count per target - for a "N comments" badge. */
export function commentCount(targetType: CommentTarget, targetId: string): number {
  return log.reduce((n, c) => n + (c.targetType === targetType && c.targetId === targetId ? 1 : 0), 0);
}

export function getComment(id: string): Comment | undefined {
  return log.find((c) => c.id === id);
}

/** Remove a comment. The route checks author/admin before calling this. */
export function removeComment(id: string): boolean {
  const i = log.findIndex((c) => c.id === id);
  if (i < 0) return false;
  log.splice(i, 1);
  persist();
  return true;
}

/** Test-only reset. */
export function __resetComments(): void {
  log.length = 0;
}
