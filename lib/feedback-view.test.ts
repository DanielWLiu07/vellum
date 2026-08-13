import { describe, expect, it } from "vitest";

import {
  type Feedback,
  type FeedbackTarget,
  GENERAL_KEY,
  groupFeedback,
  groupKeyFor,
  reportOrder,
} from "./feedback-view";

const report = (over: Partial<Feedback> = {}): Feedback => ({
  id: "fb_1",
  kind: "bug",
  message: "The timer keeps resetting.",
  reporter: "hosa_1",
  at: 1_700_000_000_000,
  resolved: false,
  ...over,
});

const target = (over: Partial<FeedbackTarget> = {}): FeedbackTarget => ({
  kind: "module",
  id: "m_1",
  title: "Cardiac rhythms",
  ...over,
});

describe("groupKeyFor", () => {
  it("keys by kind and id together, so ids reused across kinds stay apart", () => {
    expect(groupKeyFor(target({ kind: "quiz", id: "x" }))).not.toBe(
      groupKeyFor(target({ kind: "module", id: "x" })),
    );
  });

  // The point of grouping: a rename must not split one thing's history in two.
  it("ignores the title, so a renamed module keeps one bucket", () => {
    expect(groupKeyFor(target({ title: "Cardiac rhythms" }))).toBe(
      groupKeyFor(target({ title: "Cardiac rhythms (2026)" })),
    );
  });

  it("ignores the question, so every complaint about a quiz lands together", () => {
    expect(groupKeyFor(target({ kind: "quiz", question: 4 }))).toBe(
      groupKeyFor(target({ kind: "quiz", question: 11 })),
    );
  });

  it("buckets an untargeted report as general", () => {
    expect(groupKeyFor(undefined)).toBe(GENERAL_KEY);
  });
});

describe("reportOrder", () => {
  it("puts unresolved first, then newest first inside each half", () => {
    const out = reportOrder([
      report({ id: "fb_old_open", at: 1000 }),
      report({ id: "fb_new_done", at: 4000, resolved: true }),
      report({ id: "fb_new_open", at: 3000 }),
      report({ id: "fb_old_done", at: 2000, resolved: true }),
    ]);
    expect(out.map((r) => r.id)).toEqual(["fb_new_open", "fb_old_open", "fb_new_done", "fb_old_done"]);
  });

  // Resolving something must not delete the record of it: the second complaint
  // about one module reads differently once you see the first was answered.
  it("keeps resolved reports in the list rather than dropping them", () => {
    const out = reportOrder([report({ id: "a", resolved: true }), report({ id: "b" })]);
    expect(out).toHaveLength(2);
    expect(out.map((r) => r.id)).toContain("a");
  });

  it("breaks a same-millisecond tie deterministically", () => {
    const input = [report({ id: "fb_b", at: 1000 }), report({ id: "fb_a", at: 1000 })];
    expect(reportOrder(input).map((r) => r.id)).toEqual(["fb_a", "fb_b"]);
    expect(reportOrder([...input].reverse()).map((r) => r.id)).toEqual(["fb_a", "fb_b"]);
  });

  it("does not mutate its input", () => {
    const input = [report({ id: "a", resolved: true }), report({ id: "b" })];
    reportOrder(input);
    expect(input.map((r) => r.id)).toEqual(["a", "b"]);
  });
});

describe("groupFeedback", () => {
  it("collects every report about one thing into a single bucket", () => {
    const groups = groupFeedback([
      report({ id: "a", target: target() }),
      report({ id: "b", target: target({ title: "Cardiac rhythms" }) }),
      report({ id: "c", target: target({ id: "m_2", title: "Airway management" }) }),
    ]);
    expect(groups).toHaveLength(2);
    const rhythms = groups.find((g) => g.targetId === "m_1");
    expect(rhythms?.items.map((r) => r.id).sort()).toEqual(["a", "b"]);
    expect(rhythms?.title).toBe("Cardiac rhythms");
    expect(rhythms?.kind).toBe("module");
  });

  it("gives untargeted reports their own clearly named bucket", () => {
    const groups = groupFeedback([report({ id: "a" }), report({ id: "b", target: target() })]);
    const general = groups.find((g) => g.key === GENERAL_KEY);
    expect(general?.title).toBe("General");
    expect(general?.kind).toBeUndefined();
    expect(general?.items.map((r) => r.id)).toEqual(["a"]);
  });

  it("counts open and total per bucket", () => {
    const groups = groupFeedback([
      report({ id: "a", target: target() }),
      report({ id: "b", target: target(), resolved: true }),
      report({ id: "c", target: target(), resolved: true }),
    ]);
    expect(groups[0]).toMatchObject({ open: 1, total: 3 });
  });

  // The ranking is the reason for grouping: the module generating complaints
  // has to be the one you see first.
  it("ranks buckets by how many reports are still open", () => {
    const groups = groupFeedback([
      report({ id: "a", at: 9000, target: target({ id: "quiet", title: "Quiet" }) }),
      report({ id: "b", at: 1000, target: target({ id: "loud", title: "Loud" }) }),
      report({ id: "c", at: 1001, target: target({ id: "loud", title: "Loud" }) }),
    ]);
    expect(groups.map((g) => g.targetId)).toEqual(["loud", "quiet"]);
  });

  it("sinks a fully resolved bucket below one with open work, however recent", () => {
    const groups = groupFeedback([
      report({ id: "a", at: 9000, resolved: true, target: target({ id: "done", title: "Done" }) }),
      report({ id: "b", at: 1000, target: target({ id: "open", title: "Open" }) }),
    ]);
    expect(groups.map((g) => g.targetId)).toEqual(["open", "done"]);
  });

  it("breaks an equal-workload tie by most recent report", () => {
    const groups = groupFeedback([
      report({ id: "a", at: 1000, target: target({ id: "stale", title: "Stale" }) }),
      report({ id: "b", at: 5000, target: target({ id: "fresh", title: "Fresh" }) }),
    ]);
    expect(groups.map((g) => g.targetId)).toEqual(["fresh", "stale"]);
  });

  it("puts general last when it is tied with named content", () => {
    const groups = groupFeedback([
      report({ id: "a", at: 1000 }),
      report({ id: "b", at: 1000, target: target() }),
    ]);
    expect(groups.map((g) => g.key)).toEqual(["module:m_1", GENERAL_KEY]);
  });

  it("leads with general when general is where the open work is", () => {
    const groups = groupFeedback([
      report({ id: "a", at: 1000 }),
      report({ id: "b", at: 1001 }),
      report({ id: "c", at: 5000, target: target() }),
    ]);
    expect(groups[0]?.key).toBe(GENERAL_KEY);
  });

  it("orders reports inside a bucket unresolved-then-newest", () => {
    const groups = groupFeedback([
      report({ id: "done", at: 5000, resolved: true, target: target() }),
      report({ id: "older", at: 1000, target: target() }),
      report({ id: "newer", at: 3000, target: target() }),
    ]);
    expect(groups[0]?.items.map((r) => r.id)).toEqual(["newer", "older", "done"]);
  });

  // The whole reason the title is snapshotted: the content may be gone, and the
  // report still has to be readable. Nothing here may look the content up.
  it("names a bucket from the report itself, so a deleted module still reads", () => {
    const groups = groupFeedback([
      report({ id: "a", target: target({ id: "deleted_m", title: "Removed chapter 3" }) }),
    ]);
    expect(groups[0]?.title).toBe("Removed chapter 3");
  });

  it("names a renamed bucket by its freshest snapshot, in either input order", () => {
    const older = report({ id: "a", at: 1000, target: target({ title: "Cardiac rhythms" }) });
    const newer = report({ id: "b", at: 2000, target: target({ title: "Cardiac rhythms v2" }) });
    expect(groupFeedback([older, newer])[0]?.title).toBe("Cardiac rhythms v2");
    expect(groupFeedback([newer, older])[0]?.title).toBe("Cardiac rhythms v2");
  });

  it("falls back to a placeholder rather than an unclickable blank bucket", () => {
    const groups = groupFeedback([report({ target: target({ kind: "quiz", title: "   " }) })]);
    expect(groups[0]?.title).toBe("Untitled quiz");
  });

  it("handles an empty list", () => {
    expect(groupFeedback([])).toEqual([]);
  });

  it("does not mutate its input", () => {
    const input = [
      report({ id: "b", at: 1000, target: target() }),
      report({ id: "a", at: 2000, target: target() }),
    ];
    groupFeedback(input);
    expect(input.map((r) => r.id)).toEqual(["b", "a"]);
  });
});
