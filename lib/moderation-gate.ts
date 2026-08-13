/**
 * Turns a ModerationResult into what the route should actually DO.
 *
 * The old disposition was binary — allowed or refused — which forced two bad
 * outcomes. A borderline result got destroyed with no way to appeal, and a
 * result that never ran (`checked: false`) sailed through as `allowed: true`,
 * indistinguishable from "we looked and it's clean". This module makes that
 * distinction explicit and adds the middle option.
 *
 *   refuse      never store it. Reserved for categories that have no
 *               legitimate review path.
 *   quarantine  store it, force it private, queue it for a human.
 *   allow       store it as requested.
 *
 * Fail-open is preserved where it belongs and dropped where it doesn't. With
 * no API key the feature is OFF by design (keyless local/demo runs), so
 * everything is allowed. But once a key is configured, an outage or a size cap
 * no longer means "allowed" — it means "nobody has looked at this yet", which
 * is what quarantine is for. That converts an availability problem into a
 * review-latency problem instead of a hole.
 */

import { moderationConfigured, type ModerationResult } from "./moderation";

/**
 * Categories that are never stored, even for review. Deliberately minimal:
 * anything else a reviewer can reasonably adjudicate, and over-refusing just
 * recreates the unappealable-false-positive problem this replaces.
 */
export const HARD_REFUSE_CATEGORIES = ["sexual/minors"];

export type Disposition =
  | { action: "allow" }
  | { action: "refuse"; categories: string[] }
  | { action: "quarantine"; reason: "flagged" | "unchecked"; categories: string[]; detail?: string };

// Module-private: only disposition() below asks this, and nothing outside
// should. A caller that reaches for "is this a hard refusal?" on its own is
// re-deriving a disposition by hand, which is the duplication this module was
// split out to prevent — the exported entry points are disposition(),
// holdlessDisposition() and strictest(). Tests cover it through those.
function isHardRefusal(categories: string[]): boolean {
  return categories.some((c) => HARD_REFUSE_CATEGORIES.includes(c));
}

/**
 * `detail` explains a non-run for the reviewer ("image over 8MB", "render
 * failed"); callers pass it when they know why moderation couldn't cover the
 * content. It is ignored unless the disposition is an unchecked quarantine.
 */
export function disposition(mod: ModerationResult, detail?: string): Disposition {
  // Feature off entirely — no key, nothing to enforce.
  if (!moderationConfigured()) return { action: "allow" };

  if (mod.flagged) {
    return isHardRefusal(mod.categories)
      ? { action: "refuse", categories: mod.categories }
      : { action: "quarantine", reason: "flagged", categories: mod.categories };
  }

  // Configured, not flagged, but never actually examined: over a size cap, a
  // page that wouldn't render, or an API error that failed open upstream.
  if (!mod.checked) {
    return {
      action: "quarantine",
      reason: "unchecked",
      categories: [],
      ...(detail ? { detail } : {}),
    };
  }

  return { action: "allow" };
}

/**
 * What to do about content that has nowhere to be held: a comment, a folder
 * name, a profile field.
 *
 * Quarantine is "store it, force it private, queue it for a human", and two of
 * those three clauses need somewhere to put the content. A comment exists only
 * in order to be read by other people — there is no private state it could sit
 * in while it waits — and a folder name and a display name are the same. The
 * review route says this from the other end: takedownEnforceable() returns
 * false for exactly these kinds, because writing "private" against something
 * with no scope is "a no-op wearing the costume of a takedown". Queueing them
 * would hand a reviewer buttons that cannot carry out what they say, which is
 * the failure that queue exists to prevent.
 *
 * So quarantine collapses into a refusal here. The REASON survives, and that is
 * the point:
 *
 *   flagged    a model objected. Refusing costs the member a retype, which is a
 *              real cost but a far smaller one than for an upload — the text is
 *              still in their box and nothing they had is destroyed. That
 *              asymmetry is why an upload is held and a comment is not.
 *   unchecked  nobody looked: no key, over a cap, or the endpoint is down. This
 *              is the case `if (!mod.allowed)` got wrong, because a SKIPPED
 *              result is allowed:true — so during an outage unexamined text was
 *              stored as though it had been examined and cleared.
 *
 * Refusing on `unchecked` does take these features down for as long as an
 * outage lasts, and that is the intended trade. For content that goes straight
 * in front of other members with no hold available, being unable to post is the
 * better failure than publishing unreviewed material as reviewed. Callers
 * should say "try again shortly" and must not phrase it as an accusation.
 */
export type HoldlessDisposition =
  | { action: "allow" }
  | { action: "refuse"; reason: "flagged" | "unchecked"; categories: string[] };

export function holdlessDisposition(mod: ModerationResult): HoldlessDisposition {
  const disp = disposition(mod);
  if (disp.action === "allow") return { action: "allow" };
  if (disp.action === "refuse") return { action: "refuse", reason: "flagged", categories: disp.categories };
  return { action: "refuse", reason: disp.reason, categories: disp.categories };
}

/**
 * Combine the dispositions of several checks on one item (e.g. a document's
 * title text and its page images) into the single strictest outcome:
 * refuse beats quarantine beats allow. Flagged quarantines outrank unchecked
 * ones so the reviewer sees the real reason rather than a size cap.
 */
export function strictest(dispositions: Disposition[]): Disposition {
  const refusal = dispositions.find((d) => d.action === "refuse");
  if (refusal) return refusal;

  const quarantines = dispositions.filter(
    (d): d is Extract<Disposition, { action: "quarantine" }> => d.action === "quarantine",
  );
  if (quarantines.length === 0) return { action: "allow" };

  const flagged = quarantines.filter((q) => q.reason === "flagged");
  if (flagged.length > 0) {
    return {
      action: "quarantine",
      reason: "flagged",
      categories: [...new Set(flagged.flatMap((q) => q.categories))],
    };
  }
  return quarantines[0]!;
}
