// The roster Vitals builds from verified identities: who it knows, what it
// believes about them, and where the current viewer's role comes from.

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { Identity } from "./identity-token";
import { __resetProfile } from "./profile";
import { setRequestSession } from "./request-context";
import { __resetUsers, canAssign, getKnownUser, listKnownUsers, rememberUser, viewerRole } from "./users";

const identity = (over: Partial<Identity> & { sub: string }): Identity => ({
  name: "Member", chapter: "Toronto Central", role: "student", exp: 9e9, iat: 0, ...over,
});

/** Signing in as someone: the session the route layer would have resolved. */
function signIn(id: Identity): void {
  setRequestSession({
    identity: id,
    viewer: { owner: id.sub, chapter: id.chapter, admin: id.role === "admin" },
  });
}

beforeEach(() => {
  __resetUsers();
  __resetProfile();
});
afterEach(() => {
  __resetUsers();
  __resetProfile();
});

describe("rememberUser", () => {
  it("records a member the first time they're seen", () => {
    const u = rememberUser(identity({ sub: "hosa_7", name: "Ada Okafor" }));
    expect(u).toMatchObject({ id: "hosa_7", name: "Ada Okafor", chapter: "Toronto Central", role: "student" });
    expect(getKnownUser("hosa_7")?.name).toBe("Ada Okafor");
  });

  it("heals the record when HOSA changes a member's chapter or role", () => {
    const first = rememberUser(identity({ sub: "hosa_7", name: "Ada" }));
    const later = rememberUser(identity({ sub: "hosa_7", name: "Ada", chapter: "Vancouver West", role: "trainer" }));
    expect(later).toMatchObject({ chapter: "Vancouver West", role: "trainer" });
    // Same person, so their first-seen time is preserved.
    expect(later.firstSeenAt).toBe(first.firstSeenAt);
    expect(listKnownUsers()).toHaveLength(1);
  });

  it("falls back to the id when the token carries no name", () => {
    expect(rememberUser(identity({ sub: "hosa_9", name: "" })).name).toBe("hosa_9");
  });

  it("ignores an identity with no subject", () => {
    rememberUser(identity({ sub: "" }));
    expect(listKnownUsers()).toEqual([]);
  });
});

describe("chapter id vs chapter name", () => {
  it("stores the display name alongside the id", () => {
    const u = rememberUser(identity({ sub: "hosa_7", chapter: "clx3k2p9f0001", chapterName: "Toronto Central" }));
    expect(u).toMatchObject({ chapter: "clx3k2p9f0001", chapterName: "Toronto Central" });
  });

  it("stores \"\" for a legacy token that predates the field", () => {
    // Tokens minted before chapterName existed stay valid for their whole life;
    // readers fall back with `chapterName || chapter`.
    const u = rememberUser(identity({ sub: "hosa_8", chapter: "clx_legacy" }));
    expect(u.chapterName).toBe("");
    expect(u.chapterName || u.chapter).toBe("clx_legacy");
  });

  it("persists a chapter RENAME, which moves nothing but the name", () => {
    rememberUser(identity({ sub: "hosa_7", chapter: "clx_1", chapterName: "Toronto Central" }));
    rememberUser(identity({ sub: "hosa_7", chapter: "clx_1", chapterName: "Toronto Central HS" }));
    expect(getKnownUser("hosa_7")?.chapterName).toBe("Toronto Central HS");
    expect(getKnownUser("hosa_7")?.chapter).toBe("clx_1"); // the id never moved
  });

  it("clamps a long display name", () => {
    expect(rememberUser(identity({ sub: "hosa_9", chapterName: "N".repeat(200) })).chapterName).toHaveLength(80);
  });

  it("filters on the chapter ID, never the display name", () => {
    rememberUser(identity({ sub: "s1", name: "Ada", chapter: "clx_1", chapterName: "Toronto Central" }));
    rememberUser(identity({ sub: "s2", name: "Zoe", chapter: "clx_2", chapterName: "Vancouver West" }));
    expect(listKnownUsers({ chapter: "clx_1" }).map((u) => u.name)).toEqual(["Ada"]);
    // Passing the NAME where an id belongs must match nobody - if this ever
    // returns rows, the filter has been repointed at the wrong field.
    expect(listKnownUsers({ chapter: "Toronto Central" })).toEqual([]);
  });
});

describe("listKnownUsers", () => {
  beforeEach(() => {
    rememberUser(identity({ sub: "s1", name: "Ada", role: "student" }));
    rememberUser(identity({ sub: "s2", name: "Liam", role: "student" }));
    rememberUser(identity({ sub: "t1", name: "Rivera", role: "trainer" }));
    rememberUser(identity({ sub: "s3", name: "Zoe", chapter: "Vancouver West", role: "student" }));
  });

  it("narrows by chapter and by role, sorted by name", () => {
    expect(listKnownUsers({ chapter: "Toronto Central" }).map((u) => u.name)).toEqual(["Ada", "Liam", "Rivera"]);
    expect(listKnownUsers({ chapter: "Toronto Central", role: "student" }).map((u) => u.name)).toEqual(["Ada", "Liam"]);
    expect(listKnownUsers({ role: "student" }).map((u) => u.name)).toEqual(["Ada", "Liam", "Zoe"]);
    expect(listKnownUsers()).toHaveLength(4);
  });
});

describe("viewerRole", () => {
  // Order matters: a session can be entered but never cleared (enterWith has no
  // undo), so the signed-out case has to run before anything signs in - the
  // same ordering lib/auth.test.ts relies on.
  it("falls back to the local demo profile with no session", () => {
    // profile.role isn't patchable, so the signed-out demo identity is always a
    // student - the fallback can't be talked into a teaching role.
    expect(viewerRole()).toBe("student");
  });

  it("reads the role from the signed session", () => {
    signIn(identity({ sub: "hosa_3", role: "advisor" }));
    expect(viewerRole()).toBe("advisor");
  });
});

describe("canAssign", () => {
  it("is true for the teaching roles only", () => {
    expect(["trainer", "advisor", "admin"].every((r) => canAssign(r as "trainer"))).toBe(true);
    expect(canAssign("student")).toBe(false);
  });
});
