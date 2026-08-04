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

export function isHardRefusal(categories: string[]): boolean {
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
