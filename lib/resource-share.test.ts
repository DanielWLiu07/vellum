import { beforeEach, describe, expect, it } from "vitest";

import { __resetModerationQueue, enqueue, resolveEntry } from "./moderation-queue";
import { OWNER_KEY } from "./profile-types";
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

  // THE regression test for the ban. Everything above names the actor, which is
  // what let the ban pass for a working feature while nothing enforced it: the
  // actor was an optional argument, eight of nine call sites left it out, and
  // `actor && …` was false on every path a member could take. So the ban was
  // stored, listed in the admin UI, and applied to nobody.
  //
  // No actor is passed here on purpose. If someone reintroduces the parameter
  // as something a caller has to remember, this fails - which is the point,
  // because the next new route is the one that forgets.
  it("clamps the CALLER even when no actor is named - forgetting cannot switch the ban off", () => {
    banPublicSharing(OWNER_KEY, "admin"); // the viewer these tests run as
    expect(setShare("b_7", { visibility: "public" }).visibility).toBe("private");
    expect(setShare("b_8", { visibility: "chapter" }).visibility).toBe("private");
  });

  // The named actor is an override for one caller with a different subject:
  // moderation approval restores what the resource's OWNER asked for, so a ban
  // on the owner has to bite even though an unbanned admin is making the call.
  it("weighs the named actor, not the caller, when one is given", () => {
    banPublicSharing("ava", "admin");
    expect(setShare("b_9", { visibility: "public" }, undefined, "ava").visibility).toBe("private");
    // And the reverse: a banned CALLER acting on an unbanned owner's behalf.
    banPublicSharing(OWNER_KEY, "admin");
    expect(setShare("b_10", { visibility: "public" }, undefined, "ben").visibility).toBe("public");
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

  it("leaves an unbanned caller alone with nothing held (seeding stays public)", () => {
    expect(setShare("b_6", { visibility: "public" }).visibility).toBe("public");
  });
});
