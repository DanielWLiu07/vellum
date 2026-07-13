/**
 * Client-safe audit types + pure helpers. Kept separate from lib/audit (which
 * imports the server-only persistence layer) so client components can use the
 * type and the classifier without pulling node:fs into the browser bundle.
 */

export interface AuditEvent {
  id: string;
  action: string;
  target: string;
  actor: string;
  at: number;
  /** Extra context, e.g. flagged moderation categories on a *.blocked event. */
  detail?: string;
}

/** Whether an action is a moderation block (its verb ends in ".blocked"). */
export function isModerationBlock(action: string): boolean {
  return action.endsWith(".blocked");
}
