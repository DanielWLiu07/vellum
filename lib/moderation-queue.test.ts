import { beforeEach, describe, expect, it } from "vitest";

import {
  __resetModerationQueue,
  deleteQueueFor,
  describeOpenReview,
  enqueue,
  getEntry,
  holdsVisibility,
  isQuarantined,
  listPending,
  listQueue,
  pendingReportBy,
  resolveEntry,
} from "./moderation-queue";

const hold = (over: Partial<Parameters<typeof enqueue>[0]> = {}) =>
  enqueue({
    resourceId: "u_1",
    kind: "document",
    owner: "ava",
    title: "Lab safety briefing",
    reason: "flagged",
    categories: ["violence"],
    requestedVisibility: "public",
    ...over,
  });

beforeEach(() => __resetModerationQueue());

describe("moderation queue", () => {
  it("holds a flagged item as pending and reads it back", () => {
    const e = hold();
    expect(e.status).toBe("pending");
    expect(getEntry(e.id)).toEqual(e);
    expect(listPending()).toHaveLength(1);
  });

  it("reports a resource as quarantined while a hold is open, and not after", () => {
    const e = hold();
    expect(isQuarantined("u_1")).toBe(true);
    resolveEntry(e.id, "approved", "admin");
    expect(isQuarantined("u_1")).toBe(false);
  });

  it("keeps a resource quarantined while ANY of its holds is still open", () => {
    const first = hold();
    hold({ reason: "unchecked", categories: [] });
    resolveEntry(first.id, "approved", "admin");
    expect(isQuarantined("u_1")).toBe(true);
  });

  it("records who decided and when", () => {
    const e = hold();
    const done = resolveEntry(e.id, "rejected", "admin", "clearly deliberate");
    expect(done.ok).toBe(true);
    expect(done.ok && done.entry).toMatchObject({
      status: "rejected",
      reviewedBy: "admin",
      note: "clearly deliberate",
    });
    expect(done.ok && done.entry.reviewedAt).toBeTypeOf("number");
  });

  it("lets the first decision stand - a double submit cannot overwrite it", () => {
    const e = hold();
    resolveEntry(e.id, "approved", "first-admin");
    const again = resolveEntry(e.id, "rejected", "second-admin");
    expect(again.ok).toBe(false);
    expect(!again.ok && again.reason).toBe("already_decided");
    expect(getEntry(e.id)).toMatchObject({ status: "approved", reviewedBy: "first-admin" });
  });

  // The distinction that made a phantom audit line possible. Returning the
  // untouched entry for a second decision looked exactly like success, so the
  // route wrote "moderation.reject" for a rejection that never happened — into
  // the record a moderation dispute is settled from.
  it("tells a second reviewer their decision did NOT take effect", () => {
    const e = hold();
    resolveEntry(e.id, "approved", "first-admin");
    const again = resolveEntry(e.id, "rejected", "second-admin");
    expect(again).toEqual({
      ok: false,
      reason: "already_decided",
      entry: expect.objectContaining({ status: "approved", reviewedBy: "first-admin" }),
    });
  });

  // Distinct from already_decided: nothing to report back, and the caller
  // answers 404 rather than "someone beat you to it".
  it("separates an unknown id from an already-decided one", () => {
    expect(resolveEntry("mq_nope", "approved", "admin")).toEqual({ ok: false, reason: "not_found" });
  });

  it("drains pending oldest-first and keeps resolved items out of the queue", () => {
    const a = hold({ resourceId: "u_a", title: "A" });
    const b = hold({ resourceId: "u_b", title: "B" });
    expect(listPending().map((e) => e.id)).toEqual([a.id, b.id]);
    resolveEntry(a.id, "approved", "admin");
    expect(listPending().map((e) => e.id)).toEqual([b.id]);
  });

  it("lists full history newest-first, resolved items included", () => {
    hold({ resourceId: "u_a", title: "A" });
    const b = hold({ resourceId: "u_b", title: "B" });
    resolveEntry(b.id, "rejected", "admin");
    expect(listQueue()).toHaveLength(2);
    expect(listQueue()[0]!.id).toBe(b.id);
  });

  it("carries the requested visibility so approval can restore it", () => {
    expect(hold({ requestedVisibility: "chapter" }).requestedVisibility).toBe("chapter");
  });

  it("defaults an unspecified requested visibility to private", () => {
    expect(enqueue({ resourceId: "u_x", kind: "image", owner: "ava", title: "x", reason: "unchecked" })
      .requestedVisibility).toBe("private");
  });

  it("clamps an overlong title and detail", () => {
    const e = hold({ title: "t".repeat(500), detail: "d".repeat(500) });
    expect(e.title.length).toBe(200);
    expect(e.detail!.length).toBe(200);
  });

  it("drops a deleted resource's holds so it can't stay quarantined forever", () => {
    hold({ resourceId: "u_gone" });
    deleteQueueFor("u_gone");
    expect(isQuarantined("u_gone")).toBe(false);
    expect(listQueue()).toHaveLength(0);
  });
});

describe("deleting a resource that is in the queue", () => {
  // Nothing called deleteQueueFor at all, so both of these were live: the queue
  // offered a title that opened nothing (approving it answered not_found), and
  // the id stayed quarantined for the life of the process.
  it("takes the entry out of the review queue", () => {
    hold({ resourceId: "u_gone" });
    hold({ resourceId: "u_stays" });
    deleteQueueFor("u_gone");
    expect(listPending().map((e) => e.resourceId)).toEqual(["u_stays"]);
  });

  it("frees the id, so nothing is quarantined by a resource that no longer exists", () => {
    hold({ resourceId: "u_gone" });
    deleteQueueFor("u_gone");
    expect(isQuarantined("u_gone")).toBe(false);
  });

  // The caller's cue to write the deletion down. Deleting your own work while a
  // reviewer is looking at it is allowed — refusing would keep REPORTED content
  // (which stays visible while it waits) up until a human got to it — so the
  // audit line is the whole of what stops the dodge being free.
  it("hands back what was still open, so the deletion can be recorded", () => {
    hold({ resourceId: "u_gone", reason: "flagged", categories: ["violence"] });
    const open = deleteQueueFor("u_gone");
    expect(open.map((e) => e.reason)).toEqual(["flagged"]);
  });

  it("reports nothing open for a resource that was never queued", () => {
    expect(deleteQueueFor("u_never")).toEqual([]);
  });

  // A decided entry is not something anyone is still waiting on, so its
  // deletion is not the event worth logging. The decision itself is already in
  // the audit log permanently.
  it("does not report an already-decided entry as open", () => {
    const e = hold({ resourceId: "u_gone" });
    resolveEntry(e.id, "approved", "admin");
    expect(deleteQueueFor("u_gone")).toEqual([]);
    expect(listQueue()).toHaveLength(0);
  });

  it("returns several open holds in the order a reviewer would have met them", () => {
    hold({ resourceId: "u_gone", title: "first" });
    hold({ resourceId: "u_gone", title: "second", reason: "unchecked", categories: [] });
    expect(deleteQueueFor("u_gone").map((e) => e.title)).toEqual(["first", "second"]);
  });

  it("leaves another resource's entries alone", () => {
    hold({ resourceId: "u_gone" });
    const keep = hold({ resourceId: "u_other" });
    deleteQueueFor("u_gone");
    expect(listQueue().map((e) => e.id)).toEqual([keep.id]);
  });
});

describe("describeOpenReview", () => {
  const entry = (over: Partial<Parameters<typeof enqueue>[0]>) =>
    enqueue({ resourceId: "u_1", kind: "document", owner: "ava", title: "t", reason: "flagged", ...over });

  // WHO for a report and WHAT for a flag: three deletions under three different
  // members' reports is a different story from three deletions of files that
  // tripped the same category, and the bare reason word tells neither.
  it("names the reporter on a report", () => {
    expect(describeOpenReview([entry({ reason: "reported", reportedBy: "bea" })])).toBe("reported by bea");
  });

  it("names the tripped categories on a flag", () => {
    expect(describeOpenReview([entry({ reason: "flagged", categories: ["violence", "hate"] })])).toBe(
      "flagged: violence/hate",
    );
  });

  it("still says something useful when a flag reports no category", () => {
    expect(describeOpenReview([entry({ reason: "flagged", categories: [] })])).toBe("flagged");
  });

  it("falls back to the bare reason where there is nothing more to say", () => {
    expect(describeOpenReview([entry({ reason: "unchecked", categories: [] })])).toBe("unchecked");
    expect(describeOpenReview([entry({ reason: "submitted", categories: [] })])).toBe("submitted");
  });

  it("keeps every open hold rather than reporting only the first", () => {
    expect(
      describeOpenReview([
        entry({ reason: "reported", reportedBy: "bea" }),
        entry({ reason: "flagged", categories: ["violence"] }),
      ]),
    ).toBe("reported by bea; flagged: violence");
  });

  it("is empty when nothing was open", () => {
    expect(describeOpenReview([])).toBe("");
  });
});

describe("member reports", () => {
  const report = (over: Partial<Parameters<typeof enqueue>[0]> = {}) =>
    enqueue({
      resourceId: "u_1",
      kind: "document",
      owner: "ava",
      title: "Lab safety briefing",
      reason: "reported",
      reportedBy: "bea",
      reportReason: "this is a scan of a copyrighted textbook",
      requestedVisibility: "public",
      ...over,
    });

  // The property the whole feature rests on. isQuarantined is what
  // resource-share's clampVisibility consults, so if a report counted here,
  // Report would be a takedown button pointed at other members' work.
  it("does NOT quarantine the resource it is filed against", () => {
    report();
    expect(isQuarantined("u_1")).toBe(false);
  });

  it("leaves a real hold quarantining, even when a report arrives alongside it", () => {
    hold();
    report();
    expect(isQuarantined("u_1")).toBe(true);
  });

  it("does not un-quarantine anything when it is resolved", () => {
    hold();
    const r = report();
    resolveEntry(r.id, "approved", "admin");
    expect(isQuarantined("u_1")).toBe(true);
  });

  it("still queues for review like any other entry", () => {
    const r = report();
    expect(listPending().map((e) => e.id)).toContain(r.id);
    expect(getEntry(r.id)!.status).toBe("pending");
  });

  it("keeps the reporter and their words for the reviewer", () => {
    const r = report();
    expect(r.reportedBy).toBe("bea");
    expect(r.reportReason).toBe("this is a scan of a copyrighted textbook");
  });

  it("clamps an overlong reason rather than storing an essay", () => {
    expect(report({ reportReason: "r".repeat(4000) }).reportReason!.length).toBe(1000);
  });

  it("finds a member's own open report so a second press doesn't stack the queue", () => {
    const r = report();
    expect(pendingReportBy("u_1", "bea")!.id).toBe(r.id);
  });

  // Two members independently reporting one file is the strongest signal a
  // reviewer gets. Deduplicating across reporters would erase it.
  it("treats another member's report of the same thing as a separate report", () => {
    report();
    expect(pendingReportBy("u_1", "cara")).toBeUndefined();
  });

  it("does not match a report on a different resource", () => {
    report();
    expect(pendingReportBy("u_other", "bea")).toBeUndefined();
  });

  // A decided report is a closed case. Reporting again afterwards is a new
  // claim — possibly "you got this wrong" — and must reach the queue.
  it("lets the same member report again once their first report is decided", () => {
    const r = report();
    resolveEntry(r.id, "rejected", "admin");
    expect(pendingReportBy("u_1", "bea")).toBeUndefined();
  });

  it("ignores non-report holds when looking for a member's open report", () => {
    hold();
    expect(pendingReportBy("u_1", "bea")).toBeUndefined();
  });
});

describe("holdsVisibility", () => {
  // One predicate answers two questions that MUST agree: does a pending entry
  // force the resource private, and does approving it hand a visibility back.
  // An entry that never held the content has nothing to release, and an
  // approval that wrote one anyway would move content moderation never governed
  // — that is exactly how dismissing a report republished a withdrawn file.
  it.each(["flagged", "unchecked", "submitted"] as const)("holds a %s entry", (reason) => {
    expect(holdsVisibility(reason)).toBe(true);
  });

  it("does not hold a reported entry", () => {
    expect(holdsVisibility("reported")).toBe(false);
  });
});
