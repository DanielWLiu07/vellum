import { beforeEach, describe, expect, it } from "vitest";

import { __resetModerationQueue, enqueue, resolveEntry } from "./moderation-queue";
import { deleteShare, getShare, setShare } from "./resource-share";
import { __resetShareBans, banPublicSharing, liftPublicShareBan } from "./share-ban";

describe("resource share sidecar", () => {
  it("is empty for an unshared doc", () => {
    expect(getShare("u_unshared")).toBeUndefined();
  });

  it("records and reads back a share state", () => {
    setShare("u_a", { visibility: "public", chapter: "" });
    expect(getShare("u_a")).toEqual({ visibility: "public", chapter: "", people: [] });
  });

  it("clamps an overlong chapter", () => {
    setShare("u_b", { visibility: "chapter", chapter: "x".repeat(200) });
    expect(getShare("u_b")!.chapter.length).toBe(80);
  });

  it("merges partial patches - a scope change preserves the people list", () => {
    setShare("u_c", { people: [{ person: "Ava", role: "editor" }] });
    setShare("u_c", { visibility: "chapter", chapter: "Toronto Central" });
    expect(getShare("u_c")).toEqual({
      visibility: "chapter",
      chapter: "Toronto Central",
      people: [{ person: "Ava", role: "editor" }],
    });
  });

  it("merges partial patches - a people change preserves the scope", () => {
    setShare("u_d", { visibility: "private", chapter: "" });
    setShare("u_d", { people: [{ person: "Ben", role: "viewer" }] });
    expect(getShare("u_d")!.visibility).toBe("private");
    expect(getShare("u_d")!.people).toEqual([{ person: "Ben", role: "viewer" }]);
  });

  it("seeds defaults on first write so a people-only patch doesn't invent a scope", () => {
    setShare("u_e", { people: [] }, { visibility: "private", chapter: "TC" });
    expect(getShare("u_e")).toEqual({ visibility: "private", chapter: "TC", people: [] });
  });

  it("keeps a name override across unrelated patches", () => {
    setShare("u_f", { name: "Renamed.pdf" });
    setShare("u_f", { visibility: "public" });
    expect(getShare("u_f")!.name).toBe("Renamed.pdf");
  });

  it("normalizes an untrusted people patch", () => {
    setShare("u_g", { people: [{ person: "  Cam  ", role: "owner" as never }, null as never] });
    expect(getShare("u_g")!.people).toEqual([{ person: "Cam", role: "viewer" }]);
  });

  it("deleteShare drops the entry", () => {
    setShare("u_h", { visibility: "public" });
    deleteShare("u_h");
    expect(getShare("u_h")).toBeUndefined();
  });
});

describe("setShare is the gate to an audience", () => {
  beforeEach(() => {
    __resetModerationQueue();
    __resetShareBans();
  });

  it("forces a held resource private however loudly the caller asks otherwise", () => {
    enqueue({ resourceId: "q_1", kind: "document", owner: "ava", title: "held", reason: "flagged" });
    expect(setShare("q_1", { visibility: "public" }).visibility).toBe("private");
    expect(setShare("q_1", { visibility: "chapter" }).visibility).toBe("private");
  });

  it("releases the resource once the hold is resolved", () => {
    const e = enqueue({ resourceId: "q_2", kind: "document", owner: "ava", title: "held", reason: "flagged" });
    expect(setShare("q_2", { visibility: "public" }).visibility).toBe("private");
    resolveEntry(e.id, "approved", "admin");
    expect(setShare("q_2", { visibility: "public" }).visibility).toBe("public");
  });

  it("clamps a banned owner to private", () => {
    banPublicSharing("ava", "admin");
    expect(setShare("b_1", { visibility: "public" }, undefined, "ava").visibility).toBe("private");
  });

  it("clamps a banned owner's CHAPTER scope too - a chapter is an audience", () => {
    banPublicSharing("ava", "admin");
    expect(setShare("b_2", { visibility: "chapter" }, undefined, "ava").visibility).toBe("private");
  });

  it("does not clamp a different, unbanned owner", () => {
    banPublicSharing("ava", "admin");
    expect(setShare("b_3", { visibility: "public" }, undefined, "ben").visibility).toBe("public");
  });

  it("lets a lifted ban restore the ability to share", () => {
    banPublicSharing("ava", "admin");
    expect(setShare("b_4", { visibility: "public" }, undefined, "ava").visibility).toBe("private");
    liftPublicShareBan("ava");
    expect(setShare("b_4", { visibility: "public" }, undefined, "ava").visibility).toBe("public");
  });

  it("leaves named per-person grants intact through a clamp, so a reviewer can still be added", () => {
    banPublicSharing("ava", "admin");
    const state = setShare(
      "b_5",
      { visibility: "public", people: [{ person: "Reviewer", role: "viewer" }] },
      undefined,
      "ava",
    );
    expect(state.visibility).toBe("private");
    expect(state.people).toEqual([{ person: "Reviewer", role: "viewer" }]);
  });

  it("is unaffected when no actor is supplied and nothing is held (seeding stays public)", () => {
    expect(setShare("b_6", { visibility: "public" }).visibility).toBe("public");
  });
});
