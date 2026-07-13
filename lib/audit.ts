/**
 * Audit log for dashboard actions, mirroring the host platform's audit trail.
 *
 * Demo-grade in-memory ring buffer (per serverless instance). Records who did
 * what to which target, with an optional `detail` (e.g. the moderation
 * categories that tripped a block). A production build would write these to a
 * database.
 */

import { type AuditEvent, isModerationBlock } from "./audit-shared";
import { isHydrated, registerHydrator } from "./durable";
import { loadSnapshot, saveSnapshot } from "./persist";
import { getViewer } from "./profile";

export { type AuditEvent, isModerationBlock };

const CAP = 500;

const g = globalThis as unknown as { __vellumAudit?: AuditEvent[] };
const log: AuditEvent[] = (g.__vellumAudit ??= seed());

registerHydrator(async () => {
  const snap = await loadSnapshot<AuditEvent[]>("audit");
  if (snap) { log.length = 0; log.push(...snap); }
});

function seed(): AuditEvent[] {
  const now = Date.now();
  return [
    { id: "seed_3", action: "document.share", target: "Vitals - overview (sample)", actor: "system", at: now - 1000 * 60 * 9 },
    { id: "seed_2", action: "deck.create", target: "HOSA - sample terms", actor: "system", at: now - 1000 * 60 * 70 },
    { id: "seed_1", action: "document.upload", target: "Lab safety briefing", actor: "system", at: now - 1000 * 60 * 60 * 26 },
  ];
}

/**
 * Record an audit event. The actor is the authenticated member (getViewer's
 * owner - a HOSA member id, or the demo "you") by default; pass `actor`
 * explicitly for events fired before the session is resolved (e.g. sign-in).
 */
export function recordAudit(action: string, target: string, detail?: string, actor?: string): void {
  log.unshift({
    id: `e_${Math.random().toString(36).slice(2, 10)}`,
    action,
    target,
    actor: actor ?? getViewer().owner,
    at: Date.now(),
    ...(detail ? { detail } : {}),
  });
  if (log.length > CAP) log.length = CAP;
  if (isHydrated()) saveSnapshot("audit", log);
}

export function listAudit(): AuditEvent[] {
  return [...log];
}

/** Only the moderation-block events, newest-first. */
export function listModerationBlocks(): AuditEvent[] {
  return log.filter((e) => isModerationBlock(e.action));
}
