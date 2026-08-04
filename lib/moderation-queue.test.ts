import { beforeEach, describe, expect, it } from "vitest";

import {
  __resetModerationQueue,
  deleteQueueFor,
  enqueue,
  entriesForResource,
  getEntry,
  isQuarantined,
  listPending,
  listQueue,
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
    const done = resolveEntry(e.id, "rejected", "admin", "clearly deliberate")!;
    expect(done.status).toBe("rejected");
    expect(done.reviewedBy).toBe("admin");
    expect(done.reviewedAt).toBeTypeOf("number");
    expect(done.note).toBe("clearly deliberate");
  });

  it("lets the first decision stand - a double submit cannot overwrite it", () => {
    const e = hold();
    resolveEntry(e.id, "approved", "first-admin");
    const again = resolveEntry(e.id, "rejected", "second-admin")!;
    expect(again.status).toBe("approved");
    expect(again.reviewedBy).toBe("first-admin");
  });

  it("returns undefined for an unknown id", () => {
    expect(resolveEntry("mq_nope", "approved", "admin")).toBeUndefined();
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

  it("groups every hold for one resource, newest first", () => {
    hold({ resourceId: "u_z", title: "first" });
    hold({ resourceId: "u_z", title: "second" });
    expect(entriesForResource("u_z").map((e) => e.title)).toEqual(["second", "first"]);
  });

  it("drops a deleted resource's holds so it can't stay quarantined forever", () => {
    hold({ resourceId: "u_gone" });
    deleteQueueFor("u_gone");
    expect(isQuarantined("u_gone")).toBe(false);
    expect(listQueue()).toHaveLength(0);
  });
});
