/**
 * Publishing decisions: who may put something in front of the whole
 * organisation, and who has to ask first.
 *
 * Until now the only gate on going live was automatic moderation. Anything the
 * model didn't object to went public the moment a member chose "public" — so
 * the review queue only ever saw content a machine had already doubted, and
 * nobody approved the ordinary case. That is backwards for a students'
 * platform: the risky part of publishing isn't the rare flagged file, it's the
 * everyday one nobody looked at.
 *
 * WHERE THE LINE SITS. Not on everything — gating private notes would make the
 * admin a bottleneck on people's own files, and a queue nobody can drain gets
 * ignored, which is worse than no queue. The line is `public`, and the codebase
 * already drew it there: share-ban.ts bans *public* sharing specifically, and
 * clampVisibility only ever clamps a non-private request. Public means every
 * HOSA member in the country plus the copyright and minor-safety exposure that
 * comes with it. Chapter means your own classmates, with an advisor already
 * watching. So chapter stays self-serve and public is a submission.
 *
 * ADMINS PUBLISH DIRECTLY. They are the approvers; routing them into their own
 * queue would just be a step they rubber-stamp.
 *
 * WHERE IT APPLIES: every route that can raise a resource's visibility, which
 * is documents, decks, and quizzes — the three things that have a `public`
 * scope at all. For a while it was documents only, so the same student's PDF
 * waited on a reviewer while their flashcard deck reached every member in the
 * country the moment they pressed Save. One question, two answers, decided by
 * which kind of thing they happened to be sharing.
 */

import type { Visibility } from "./visibility";

export type PublishDecision =
  /** Apply the requested visibility now. */
  | { kind: "apply"; visibility: Visibility }
  /** Hold at `hold` and queue a submission for a reviewer. */
  | { kind: "submit"; hold: Visibility };

export interface PublishRequest {
  requested: Visibility;
  /** What the resource is set to today. */
  current: Visibility;
  isAdmin: boolean;
}

export function decidePublish({ requested, current, isAdmin }: PublishRequest): PublishDecision {
  // Private and chapter are the member's own call.
  if (requested !== "public") return { kind: "apply", visibility: requested };
  if (isAdmin) return { kind: "apply", visibility: requested };

  // Hold at what they already had, NOT at private. A doc already shared with
  // its chapter would otherwise lose that audience the moment its owner asked
  // for more — taking access away as the price of requesting it, which reads
  // as a punishment and teaches people not to ask.
  return { kind: "submit", hold: current };
}

/**
 * The same decision, flattened to the two facts a route needs: what to store,
 * and whether a reviewer now owes the member an answer.
 *
 * It exists because four call sites (deck and quiz, create and update) were
 * each about to re-derive "submit means store the hold" from the union, and a
 * rule spelled out four times is a rule three of them can spell differently.
 * The union stays exported for callers that branch on the outcome.
 */
export function resolvePublish(req: PublishRequest): { visibility: Visibility; submitted: boolean } {
  const decision = decidePublish(req);
  return decision.kind === "apply"
    ? { visibility: decision.visibility, submitted: false }
    : { visibility: decision.hold, submitted: true };
}

/**
 * Whether a resource is live to the whole organisation. The "Posted" view is
 * derived from this rather than stored, because a second record of what is
 * public is a second thing to drift.
 */
export function isPosted(visibility: string): boolean {
  return visibility === "public";
}
