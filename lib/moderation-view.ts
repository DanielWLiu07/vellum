/**
 * Presentation logic for the moderation review queue.
 *
 * Split out of the component because the interesting part isn't layout, it's
 * the wording: an item held because a model tripped a category, an item held
 * because nothing could read it, and an item a member complained about are the
 * same `pending` status but completely different asks of a reviewer. Conflating
 * them was the bug the queue was built to avoid (see lib/moderation-queue), so
 * the labels have to keep them apart — and that is worth testing without a DOM.
 */

export type QueueReason = "flagged" | "unchecked" | "submitted" | "reported";
export type QueueStatus = "pending" | "approved" | "rejected";

/** The queue fields the view needs. Mirrors QueueEntry in moderation-queue. */
export interface ReviewItem {
  id: string;
  resourceId: string;
  kind: string;
  owner: string;
  title: string;
  categories: string[];
  reason: QueueReason;
  detail?: string;
  /** Who pressed Report; `reported` entries only. */
  reportedBy?: string;
  /** What they said was wrong with it; `reported` entries only. */
  reportReason?: string;
  status: QueueStatus;
  createdAt: number;
  reviewedBy?: string;
  reviewedAt?: number;
}

export type Tone = "flagged" | "unchecked" | "submitted" | "reported" | "ok" | "muted";

export interface StatusBadge {
  label: string;
  tone: Tone;
  /** The sentence under the title: what a reviewer needs in order to decide. */
  detail: string;
}

/**
 * A reported entry answers differently at EVERY status, so it branches on
 * reason before status rather than after.
 *
 * The generic decided-wording is written for a HELD item and is false twice
 * over for a report: "released, the requested visibility was restored" when
 * nothing was ever held and nothing was restored, and "the item stays private
 * to its owner" when a dismissed report leaves the content exactly as public as
 * it was. A reviewer reading back a week-old decision would take both of those
 * as fact.
 */
function reportedBadge(item: ReviewItem): StatusBadge {
  if (item.status === "approved") {
    return {
      label: "Report dismissed",
      tone: "ok",
      // Says what did NOT happen, deliberately. The reporter's complaint is on
      // the same card, so "dismissed" alone invites the reader to assume some
      // action was taken anyway.
      detail: "A reviewer read the report and let the content stand. Its sharing was not changed.",
    };
  }
  if (item.status === "rejected") {
    return {
      label: "Taken down",
      tone: "muted",
      detail: "The report was upheld — the content was made private and is no longer shared.",
    };
  }
  const who = item.reportedBy ? `${item.reportedBy} reported this` : "A member reported this";
  return {
    label: "Reported",
    tone: "reported",
    // The reporter's words go through verbatim and unsummarised. A report is
    // an accusation from a person, so the reviewer is judging the accusation
    // as much as the content, and paraphrasing it decides the case for them.
    // The visibility sentence is not decoration: unlike every other reason in
    // this queue the content is still up, so the reviewer is looking at live
    // material and needs to know the clock is running.
    detail: item.reportReason
      ? `${who}: "${item.reportReason}" It is still visible while you decide.`
      : `${who} but gave no reason. It is still visible while you decide.`,
  };
}

/**
 * `checked and clean` is deliberately absent: a clean item never enters the
 * queue, so anything here is held, approved, or rejected. Saying "not flagged"
 * about a queue entry would be a category error.
 */
export function statusBadge(item: ReviewItem): StatusBadge {
  if (item.reason === "reported") return reportedBadge(item);
  if (item.status === "approved") {
    return { label: "Approved", tone: "ok", detail: "Released — the creator's requested visibility was restored." };
  }
  if (item.status === "rejected") {
    return { label: "Rejected", tone: "muted", detail: "Hold upheld — the item stays private to its owner." };
  }
  if (item.reason === "submitted") {
    return {
      label: "Submitted",
      tone: "submitted",
      // Nothing is wrong with it. Reviewing this is an editorial judgement —
      // is it good enough to put in front of everyone — not a suspicion.
      detail: "A member is asking to publish this to every HOSA member. Nothing was flagged.",
    };
  }
  if (item.reason === "flagged") {
    return {
      label: "Flagged",
      tone: "flagged",
      detail: item.categories.length
        ? `Automatic moderation tripped: ${item.categories.join(", ")}.`
        : "Automatic moderation objected but reported no category.",
    };
  }
  return {
    label: "Not checked",
    tone: "unchecked",
    // The distinction that matters: nobody looked. Reading this as an
    // accusation is what makes reviewers reject good material.
    detail: item.detail
      ? `Moderation never examined this (${item.detail}). It is not an accusation — it needs eyes.`
      : "Moderation never examined this. It is not an accusation — it needs eyes.",
  };
}

export interface ReviewActions {
  /** Button label for the `approve` wire action on this entry. */
  approve: string;
  /** Button label for the `reject` wire action on this entry. */
  reject: string;
}

/**
 * What the two review buttons should SAY for a given entry.
 *
 * /api/moderation takes approve/reject for every reason, and the object of both
 * verbs is the content: approve means it stands, reject means it doesn't. That
 * is unambiguous while the entry is a hold — the card is the held thing, and
 * "Approve" plainly means let it out. It stops being unambiguous for a report,
 * where the card carries somebody's accusation and "Approve" reads just as
 * easily as "approve the report", which is the OPPOSITE outcome. A reviewer
 * pressing the wrong one there either leaves harmful material up or takes an
 * innocent member's work down.
 *
 * So the wire keeps one pair of verbs and the buttons stop using them for
 * reports. "Take it down" matches what the console already calls making a
 * resource private, so the language is one a reviewer has met before.
 */
export function reviewActions(item: ReviewItem): ReviewActions {
  return item.reason === "reported"
    ? { approve: "Dismiss report", reject: "Take it down" }
    : { approve: "Approve", reject: "Reject" };
}

/** Documents and images can show a real preview; the rest get a placeholder. */
export function isPreviewableKind(kind: string): boolean {
  return kind === "document" || kind === "image";
}

export interface QueueSummary {
  pending: number;
  flagged: number;
  unchecked: number;
  submitted: number;
  reported: number;
}

export function summarize(items: readonly ReviewItem[]): QueueSummary {
  const pending = items.filter((i) => i.status === "pending");
  const by = (reason: QueueReason) => pending.filter((i) => i.reason === reason).length;
  return {
    pending: pending.length,
    flagged: by("flagged"),
    unchecked: by("unchecked"),
    submitted: by("submitted"),
    reported: by("reported"),
  };
}

/**
 * Reported first, then flagged, then unattended, then ordinary submissions.
 *
 * Straight oldest-first is right WITHIN a reason but wrong across them: a
 * flagged file sitting behind fifty routine publish requests is the one case
 * where queue order actually matters. Within a band it stays oldest-first so
 * nothing starves.
 *
 * Reported outranks flagged, which looks backwards — a model's flag sounds
 * more serious than one member's opinion — but the two are in different
 * situations. A flagged item is ALREADY private: the queue holds it, so review
 * latency costs the uploader access to their own file and costs everyone else
 * nothing. A reported item is deliberately still visible (see isQuarantined in
 * lib/moderation-queue), so review latency is the only thing standing between
 * the whole platform and whatever the reporter is complaining about. Delay is
 * cheap in one band and expensive in the other, so the expensive one goes
 * first. It also means a member who takes the trouble to report something sees
 * an answer, which is what makes anyone bother reporting a second time.
 */
const REASON_PRIORITY: Record<QueueReason, number> = {
  reported: 0,
  flagged: 1,
  unchecked: 2,
  submitted: 3,
};

export function triageOrder<T extends ReviewItem & { seq?: number }>(items: readonly T[]): T[] {
  return [...items].sort(
    (a, b) =>
      REASON_PRIORITY[a.reason] - REASON_PRIORITY[b.reason] ||
      a.createdAt - b.createdAt ||
      (a.seq ?? 0) - (b.seq ?? 0),
  );
}

/**
 * Oldest first. A review queue drained newest-first starves its oldest item
 * forever, and `seq` exists precisely because same-millisecond `createdAt`
 * ties make the order flaky.
 */
export function reviewOrder<T extends { createdAt: number; seq?: number }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => a.createdAt - b.createdAt || (a.seq ?? 0) - (b.seq ?? 0));
}
