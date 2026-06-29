/**
 * Audit log for dashboard actions, mirroring the host platform's audit trail.
 *
 * Demo-grade in-memory ring buffer (per serverless instance). Records who did
 * what to which target. A production build would write these to a database.
 */

export interface AuditEvent {
  id: string;
  action: string;
  target: string;
  actor: string;
  at: number;
}

const CAP = 200;

const g = globalThis as unknown as { __vellumAudit?: AuditEvent[] };
const log: AuditEvent[] = (g.__vellumAudit ??= seed());

function seed(): AuditEvent[] {
  const now = Date.now();
  return [
    { id: "seed_3", action: "document.share", target: "Vitals - overview (sample)", actor: "system", at: now - 1000 * 60 * 9 },
    { id: "seed_2", action: "deck.create", target: "HOSA - sample terms", actor: "system", at: now - 1000 * 60 * 70 },
    { id: "seed_1", action: "document.upload", target: "Lab safety briefing", actor: "system", at: now - 1000 * 60 * 60 * 26 },
  ];
}

export function recordAudit(action: string, target: string, actor = "unknown"): void {
  log.unshift({
    id: `e_${Math.random().toString(36).slice(2, 10)}`,
    action,
    target,
    actor,
    at: Date.now(),
  });
  if (log.length > CAP) log.length = CAP;
}

export function listAudit(): AuditEvent[] {
  return [...log];
}
