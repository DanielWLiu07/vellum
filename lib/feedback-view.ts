/**
 * Grouping and ordering for the admin report list.
 *
 * A flat feed answers "what came in" and nothing else. The question an admin
 * actually arrives with is "what is this module generating complaints about",
 * so reports are bucketed by the content they name and the buckets are ranked
 * by how much unattended work each one represents.
 *
 * Nothing here reads the content stores, and it must stay that way: a report
 * carries the title it was filed against, so a module deleted last week still
 * renders as itself instead of as a dead id or a blank row.
 */

export type FeedbackKind = "bug" | "idea" | "other";
export type FeedbackTargetKind = "module" | "doc" | "quiz";

/** Mirrors FeedbackTarget in lib/feedback, as it arrives over JSON. */
export interface FeedbackTarget {
  kind: FeedbackTargetKind;
  id: string;
  /** Snapshotted when the report was filed — survives a rename or a delete. */
  title: string;
  /** 1-based question number; quizzes only. */
  question?: number;
}

/** Mirrors Feedback in lib/feedback. */
export interface Feedback {
  id: string;
  kind: FeedbackKind;
  message: string;
  page?: string;
  reporter: string;
  at: number;
  resolved: boolean;
  /** The content this report is about. Absent means a general report. */
  target?: FeedbackTarget;
}

/** Tab key for the everything view. Not a group — no report belongs to it. */
export const ALL_KEY = "all";
/** Tab key and bucket for reports that name no content. */
export const GENERAL_KEY = "general";

export const TARGET_KIND_LABEL: Record<FeedbackTargetKind, string> = {
  module: "Module",
  doc: "Resource",
  quiz: "Quiz",
};

/**
 * Bucket identity is kind + id, deliberately not the title: a renamed module
 * files its later reports under a new title, and splitting one thing's history
 * into two piles is the exact opposite of what this view is for. `question` is
 * left out for the same reason — every question in a quiz is a complaint about
 * that quiz, and per-question buckets would scatter them.
 */
export function groupKeyFor(target?: FeedbackTarget): string {
  return target ? `${target.kind}:${target.id}` : GENERAL_KEY;
}

export interface FeedbackGroup {
  key: string;
  /** What to call the bucket: the snapshotted title, or "General". */
  title: string;
  /** Absent on the general bucket, which names no content. */
  kind?: FeedbackTargetKind;
  targetId?: string;
  /** Ordered by reportOrder. */
  items: Feedback[];
  /** Unresolved: the part still asking for something. */
  open: number;
  total: number;
}

/**
 * Unresolved first, newest first within each half.
 *
 * Resolved reports stay in the list rather than disappearing — the second
 * complaint about one module reads completely differently once you can see the
 * first was already answered — but they sort below everything open so they
 * never sit between an admin and live work.
 */
export function reportOrder<T extends { id: string; at: number; resolved: boolean }>(
  items: readonly T[],
): T[] {
  return [...items].sort(
    (a, b) =>
      Number(a.resolved) - Number(b.resolved) ||
      b.at - a.at ||
      // Two reports filed in the same millisecond would otherwise land in
      // whatever order the fetch happened to return them in, and flip on the
      // next reload. Any total order will do; it just has to be stable.
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

interface Bucket extends FeedbackGroup {
  /** Newest report in the bucket — the freshness half of the ranking. */
  latestAt: number;
}

/**
 * Bucket by target, then rank the buckets: most open reports first.
 *
 * Ranking by recency alone buries the module with five open complaints under
 * whichever one someone happened to mention most recently, and that ranking is
 * the whole reason for grouping. A bucket whose reports are all resolved falls
 * to the bottom however loud its history was.
 */
export function groupFeedback(items: readonly Feedback[]): FeedbackGroup[] {
  const buckets = new Map<string, Bucket>();

  for (const item of items) {
    const key = groupKeyFor(item.target);
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = {
        key,
        title: "General",
        kind: item.target?.kind,
        targetId: item.target?.id,
        items: [],
        open: 0,
        total: 0,
        latestAt: -Infinity,
      };
      buckets.set(key, bucket);
    }
    // Freshest snapshot wins, so content renamed since the first complaint
    // reads under the name it answers to now. A blank title would leave the
    // bucket with no handle at all, which is worse than an honest placeholder.
    if (item.target && item.at > bucket.latestAt) {
      bucket.title = item.target.title.trim() || `Untitled ${TARGET_KIND_LABEL[item.target.kind].toLowerCase()}`;
    }
    if (item.at > bucket.latestAt) bucket.latestAt = item.at;
    bucket.items.push(item);
    bucket.total += 1;
    if (!item.resolved) bucket.open += 1;
  }

  return [...buckets.values()]
    .sort(
      (a, b) =>
        b.open - a.open ||
        b.latestAt - a.latestAt ||
        // On a tie, "the app in general" is a weaker lead than a named piece of
        // content: it is the bucket you read when nothing else is asking.
        Number(a.key === GENERAL_KEY) - Number(b.key === GENERAL_KEY) ||
        a.title.localeCompare(b.title),
    )
    .map((bucket) => ({
      key: bucket.key,
      title: bucket.title,
      kind: bucket.kind,
      targetId: bucket.targetId,
      items: reportOrder(bucket.items),
      open: bucket.open,
      total: bucket.total,
    }));
}
