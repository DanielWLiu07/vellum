import { describe, expect, it } from "vitest";

import {
  isPreviewableKind,
  type ReviewItem,
  reviewActions,
  reviewOrder,
  triageOrder,
  statusBadge,
  summarize,
} from "./moderation-view";

const item = (over: Partial<ReviewItem> = {}): ReviewItem => ({
  id: "mq_1",
  resourceId: "u_1",
  kind: "document",
  owner: "hosa_1",
  title: "ECG interpretation guide",
  categories: [],
  reason: "flagged",
  status: "pending",
  createdAt: 1_700_000_000_000,
  ...over,
});

describe("statusBadge", () => {
  it("names the tripped categories on a flagged hold", () => {
    const b = statusBadge(item({ reason: "flagged", categories: ["violence", "hate"] }));
    expect(b.label).toBe("Flagged");
    expect(b.tone).toBe("flagged");
    expect(b.detail).toContain("violence, hate");
  });

  it("still reads sensibly when a flag reports no category", () => {
    const b = statusBadge(item({ reason: "flagged", categories: [] }));
    expect(b.label).toBe("Flagged");
    expect(b.detail).toMatch(/no category/i);
  });

  // The distinction the queue exists for. An unchecked hold is "nobody looked",
  // and a reviewer who reads it as an accusation rejects good coursework.
  it("says an unchecked hold is not an accusation, and why it wasn't checked", () => {
    const b = statusBadge(item({ reason: "unchecked", detail: "page images checked 3/40" }));
    expect(b.label).toBe("Not checked");
    expect(b.tone).toBe("unchecked");
    expect(b.detail).toContain("page images checked 3/40");
    expect(b.detail).toMatch(/not an accusation/i);
  });

  it("never labels an unchecked hold as flagged", () => {
    expect(statusBadge(item({ reason: "unchecked" })).label).not.toBe("Flagged");
  });

  it("reports a decision once one has been made, whatever the original reason", () => {
    expect(statusBadge(item({ status: "approved", reason: "flagged" }))).toMatchObject({
      label: "Approved",
      tone: "ok",
    });
    expect(statusBadge(item({ status: "rejected", reason: "unchecked" }))).toMatchObject({
      label: "Rejected",
      tone: "muted",
    });
  });
});

describe("isPreviewableKind", () => {
  it.each(["document", "image"])("previews %s", (k) => expect(isPreviewableKind(k)).toBe(true));
  it.each(["deck", "quiz", "comment", "folder", "profile"])("falls back for %s", (k) =>
    expect(isPreviewableKind(k)).toBe(false),
  );
});

describe("summarize", () => {
  it("splits pending into flagged and unchecked", () => {
    expect(
      summarize([
        item({ id: "a", reason: "flagged" }),
        item({ id: "b", reason: "unchecked" }),
        item({ id: "c", reason: "unchecked" }),
      ]),
    ).toEqual({ pending: 3, flagged: 1, unchecked: 2, submitted: 0, reported: 0 });
  });

  it("counts only pending items — decided ones are not a backlog", () => {
    expect(
      summarize([item({ id: "a" }), item({ id: "b", status: "approved" }), item({ id: "c", status: "rejected" })]),
    ).toEqual({ pending: 1, flagged: 1, unchecked: 0, submitted: 0, reported: 0 });
  });

  it("handles an empty queue", () => {
    expect(summarize([])).toEqual({ pending: 0, flagged: 0, unchecked: 0, submitted: 0, reported: 0 });
  });
});

describe("reviewOrder", () => {
  it("puts the oldest first so a backlog drains instead of starving", () => {
    const out = reviewOrder([
      item({ id: "new", createdAt: 3000 }),
      item({ id: "old", createdAt: 1000 }),
      item({ id: "mid", createdAt: 2000 }),
    ]);
    expect(out.map((i) => i.id)).toEqual(["old", "mid", "new"]);
  });

  // Same-millisecond enqueues tie on createdAt, which is exactly why the queue
  // carries seq. A tied sort would make the order flaky between renders.
  it("breaks a same-millisecond tie by seq", () => {
    const out = reviewOrder([
      { ...item({ id: "second", createdAt: 1000 }), seq: 2 },
      { ...item({ id: "first", createdAt: 1000 }), seq: 1 },
    ]);
    expect(out.map((i) => i.id)).toEqual(["first", "second"]);
  });

  it("does not mutate its input", () => {
    const input = [item({ id: "b", createdAt: 2000 }), item({ id: "a", createdAt: 1000 })];
    reviewOrder(input);
    expect(input.map((i) => i.id)).toEqual(["b", "a"]);
  });
});

describe("submitted holds — the ordinary publish request", () => {
  it("reads as a request, not a suspicion", () => {
    const b = statusBadge(item({ reason: "submitted", categories: [] }));
    expect(b.label).toBe("Submitted");
    expect(b.tone).toBe("submitted");
    expect(b.detail).toMatch(/asking to publish/i);
    expect(b.detail).toMatch(/nothing was flagged/i);
  });

  it("counts separately from the two suspicion reasons", () => {
    expect(
      summarize([
        item({ id: "a", reason: "submitted" }),
        item({ id: "b", reason: "submitted" }),
        item({ id: "c", reason: "flagged" }),
        item({ id: "d", reason: "unchecked" }),
      ]),
    ).toEqual({ pending: 4, submitted: 2, flagged: 1, unchecked: 1, reported: 0 });
  });
});

describe("reported holds — a member's complaint", () => {
  // A reviewer deciding a report is judging the accusation as much as the
  // content, so both halves of it have to survive into the badge: who said it,
  // and what they actually said.
  it("names the reporter and quotes their words verbatim", () => {
    const b = statusBadge(
      item({
        reason: "reported",
        reportedBy: "hosa_88",
        reportReason: "This is my chapter's exam paper, someone uploaded it without asking",
      }),
    );
    expect(b.label).toBe("Reported");
    expect(b.tone).toBe("reported");
    expect(b.detail).toContain("hosa_88");
    expect(b.detail).toContain("someone uploaded it without asking");
  });

  // The one fact about a reported item that is true of nothing else in the
  // queue: it is still up. A reviewer who assumes the platform already hid it
  // treats the item as no longer urgent, which is exactly backwards.
  it("says the content is still visible while the reviewer decides", () => {
    expect(statusBadge(item({ reason: "reported", reportedBy: "hosa_88", reportReason: "x" })).detail)
      .toMatch(/still visible/i);
  });

  it("still reads as a report when the words didn't survive", () => {
    const b = statusBadge(item({ reason: "reported", reportedBy: "hosa_88" }));
    expect(b.label).toBe("Reported");
    expect(b.detail).toContain("hosa_88");
    expect(b.detail).toMatch(/no reason/i);
  });

  it("does not claim an anonymous reporter's name", () => {
    const b = statusBadge(item({ reason: "reported", reportReason: "it's a scan of a textbook" }));
    expect(b.detail).toMatch(/a member reported this/i);
    expect(b.detail).toContain("scan of a textbook");
  });

  // The queue's own distinction: a model's flag and a person's accusation are
  // different claims, and a reviewer who can't tell them apart can't weigh them.
  it("never reads as an automatic flag", () => {
    const b = statusBadge(item({ reason: "reported", reportedBy: "hosa_88", reportReason: "x" }));
    expect(b.label).not.toBe("Flagged");
    expect(b.detail).not.toMatch(/automatic moderation/i);
  });

  it("counts separately from flags, non-checks and publish requests", () => {
    expect(
      summarize([
        item({ id: "a", reason: "reported" }),
        item({ id: "b", reason: "reported" }),
        item({ id: "c", reason: "flagged" }),
        item({ id: "d", reason: "unchecked" }),
        item({ id: "e", reason: "submitted" }),
      ]),
    ).toEqual({ pending: 5, reported: 2, flagged: 1, unchecked: 1, submitted: 1 });
  });

  // The generic decided-wording is written for a HELD item and is false twice
  // over for a report. Both sentences below were what a reviewer read back.
  it("does not claim a dismissed report restored a visibility", () => {
    const b = statusBadge(item({ status: "approved", reason: "reported", reportedBy: "hosa_88" }));
    expect(b.label).toBe("Report dismissed");
    expect(b.detail).not.toMatch(/restored/i);
    expect(b.detail).toMatch(/sharing was not changed/i);
  });

  it("does not claim an upheld report left the content private to its owner all along", () => {
    const b = statusBadge(item({ status: "rejected", reason: "reported", reportedBy: "hosa_88" }));
    expect(b.label).toBe("Taken down");
    expect(b.detail).not.toMatch(/stays private/i);
    expect(b.detail).toMatch(/upheld/i);
    expect(b.detail).toMatch(/made private/i);
  });

  // A decided report is the one row where the label has to carry the OUTCOME:
  // "Approved" and "Rejected" describe the entry, and for a report the entry is
  // an accusation, so both read backwards.
  it("labels a decided report by what happened to the content", () => {
    const decided = ["approved", "rejected"] as const;
    for (const status of decided) {
      const label = statusBadge(item({ status, reason: "reported" })).label;
      expect(["Report dismissed", "Taken down"]).toContain(label);
    }
  });
});

describe("reviewActions", () => {
  // The wire verbs are approve/reject for every reason, and their object is the
  // content. That reads correctly on a held item and ambiguously on a report,
  // where "Approve" is just as easily "approve the report" — the opposite
  // outcome. The buttons carry the disambiguation so the reviewer never has to.
  it("names the outcome on a report instead of using the wire verbs", () => {
    expect(reviewActions(item({ reason: "reported" }))).toEqual({
      approve: "Dismiss report",
      reject: "Take it down",
    });
  });

  it("leaves the held reasons on the generic verbs, where they are unambiguous", () => {
    for (const reason of ["flagged", "unchecked", "submitted"] as const) {
      expect(reviewActions(item({ reason }))).toEqual({ approve: "Approve", reject: "Reject" });
    }
  });

  // A takedown must never be the button that reads as the safe one.
  it("never labels the reject action on a report as an approval", () => {
    const a = reviewActions(item({ reason: "reported" }));
    expect(a.approve).not.toMatch(/take.*down/i);
    expect(a.reject).not.toMatch(/dismiss/i);
  });
});

describe("triageOrder", () => {
  // Oldest-first is right WITHIN a reason and wrong across them: a flagged file
  // sitting behind fifty routine publish requests is the case that matters.
  it("puts flagged first, then unchecked, then routine submissions", () => {
    const out = triageOrder([
      item({ id: "sub", reason: "submitted", createdAt: 1000 }),
      item({ id: "unchecked", reason: "unchecked", createdAt: 2000 }),
      item({ id: "flagged", reason: "flagged", createdAt: 3000 }),
    ]);
    expect(out.map((i) => i.id)).toEqual(["flagged", "unchecked", "sub"]);
  });

  it("keeps oldest-first inside a band so nothing starves", () => {
    const out = triageOrder([
      item({ id: "newer", reason: "flagged", createdAt: 2000 }),
      item({ id: "older", reason: "flagged", createdAt: 1000 }),
    ]);
    expect(out.map((i) => i.id)).toEqual(["older", "newer"]);
  });

  // The ordering that looks wrong until you ask what waiting COSTS. A flagged
  // item is already private while it sits here, so the delay costs its owner
  // access to their own file. A reported item is deliberately still visible to
  // everyone (see isQuarantined in lib/moderation-queue), so the delay is the
  // only thing between the platform and whatever was reported.
  it("puts a member's report ahead of an automatic flag, even a much older one", () => {
    const out = triageOrder([
      item({ id: "old-flag", reason: "flagged", createdAt: 1000 }),
      item({ id: "new-report", reason: "reported", createdAt: 9000 }),
    ]);
    expect(out.map((i) => i.id)).toEqual(["new-report", "old-flag"]);
  });

  it("orders the full queue reported, flagged, unchecked, submitted", () => {
    const out = triageOrder([
      item({ id: "sub", reason: "submitted", createdAt: 1000 }),
      item({ id: "unchecked", reason: "unchecked", createdAt: 2000 }),
      item({ id: "flagged", reason: "flagged", createdAt: 3000 }),
      item({ id: "reported", reason: "reported", createdAt: 4000 }),
    ]);
    expect(out.map((i) => i.id)).toEqual(["reported", "flagged", "unchecked", "sub"]);
  });

  it("still drains reports oldest-first among themselves", () => {
    const out = triageOrder([
      item({ id: "newer", reason: "reported", createdAt: 2000 }),
      item({ id: "older", reason: "reported", createdAt: 1000 }),
    ]);
    expect(out.map((i) => i.id)).toEqual(["older", "newer"]);
  });

  it("does not mutate its input", () => {
    const input = [item({ id: "a", reason: "submitted" }), item({ id: "b", reason: "flagged" })];
    triageOrder(input);
    expect(input.map((i) => i.id)).toEqual(["a", "b"]);
  });
});
