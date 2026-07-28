import { beforeEach, describe, expect, it } from "vitest";

import { __resetProfile, getProfile, getViewer, OWNER_KEY, PROFILE_LIMITS, type ProfilePatch, updateProfile } from "./profile";
import { setRequestSession } from "./request-context";

/**
 * A caller that ignores the ProfilePatch contract - what an attacker's request
 * body looks like once it reaches the store. Chapter and role aren't in the
 * type, so this cast is the only way to hand them in.
 */
const rogueUpdate = (patch: Record<string, unknown>) => updateProfile(patch as ProfilePatch);

beforeEach(() => __resetProfile());

describe("getProfile / seed", () => {
  it("starts with a stable owner key and student defaults", () => {
    const p = getProfile();
    expect(p.owner).toBe(OWNER_KEY);
    expect(p.displayName).toBe("You");
    expect(p.role).toBe("student");
    expect(p.chapter).toBe("Toronto Central");
    expect(p.avatarImageId).toBeUndefined();
  });

  it("returns a copy - mutating the result does not touch the store", () => {
    const p = getProfile();
    p.displayName = "Hacked";
    expect(getProfile().displayName).toBe("You");
  });
});

describe("updateProfile", () => {
  it("only changes the fields present in the patch", () => {
    updateProfile({ displayName: "Jordan Chen" });
    const p = getProfile();
    expect(p.displayName).toBe("Jordan Chen");
    expect(p.chapter).toBe("Toronto Central"); // untouched
    expect(p.role).toBe("student");
  });

  it("never leaves an empty display name (falls back to You)", () => {
    updateProfile({ displayName: "Sam" });
    updateProfile({ displayName: "   " });
    expect(getProfile().displayName).toBe("You");
  });

  it("trims and clamps the display name to the limit", () => {
    updateProfile({ displayName: `  ${"a".repeat(200)}  ` });
    expect(getProfile().displayName).toHaveLength(PROFILE_LIMITS.name);
  });

  it("normalizes handles to lowercase [a-z0-9_] and clamps length", () => {
    updateProfile({ handle: "Jordan Chen! #1" });
    expect(getProfile().handle).toBe("jordanchen1");
    updateProfile({ handle: "x".repeat(50) });
    expect(getProfile().handle).toHaveLength(PROFILE_LIMITS.handle);
  });

  it("trims and clamps the bio", () => {
    updateProfile({ bio: `  ${"b".repeat(400)}  ` });
    expect(getProfile().bio).toHaveLength(PROFILE_LIMITS.bio);
  });

  it("sets and clears the avatar (null clears; long ids are clamped)", () => {
    updateProfile({ avatarImageId: "img_abc" });
    expect(getProfile().avatarImageId).toBe("img_abc");
    updateProfile({ avatarImageId: "x".repeat(200) });
    expect(getProfile().avatarImageId).toHaveLength(64);
    updateProfile({ avatarImageId: null });
    expect(getProfile().avatarImageId).toBeUndefined();
  });

  it("stamps updatedAt", () => {
    expect(getProfile().updatedAt).toBe(0);
    updateProfile({ displayName: "Sam" });
    expect(getProfile().updatedAt).toBeGreaterThan(0);
  });
});

describe("getViewer (the local demo fallback)", () => {
  it("mirrors the seed by default (matches the old DEMO_VIEWER)", () => {
    expect(getViewer()).toEqual({ owner: OWNER_KEY, chapter: "Toronto Central", admin: false });
  });

  it("keeps the owner key stable across edits (existing resources stay owned)", () => {
    updateProfile({ displayName: "New Name" });
    expect(getViewer().owner).toBe(OWNER_KEY);
  });
});

describe("role is not patchable", () => {
  // Was "accepts known roles and ignores unknown ones", from when a member
  // could set their own role. They can't: with no session getViewer() derives
  // `admin` from this profile, so a patchable role let a signed-out visitor
  // grant themselves admin. Role now comes from the signed session only.
  it("ignores a role in the patch, keeping the seeded one", () => {
    rogueUpdate({ displayName: "Jordan", role: "advisor" });
    expect(getProfile().role).toBe("student");
    expect(getProfile().displayName).toBe("Jordan"); // the rest of the patch still applies
  });

  it("keeps admin out of the member's hands", () => {
    rogueUpdate({ role: "admin" });
    expect(getProfile().role).toBe("student");
    expect(getViewer().admin).toBe(false);
  });
});

describe("chapter is not patchable", () => {
  it("ignores a chapter in the patch, keeping the seeded one", () => {
    rogueUpdate({ displayName: "Jordan", chapter: "Vancouver West" });
    expect(getProfile().chapter).toBe("Toronto Central");
    expect(getProfile().displayName).toBe("Jordan"); // the rest of the patch still applies
  });

  it("keeps the viewer's access scope out of the member's hands", () => {
    // getViewer().chapter is what chapter-scoped visibility compares against,
    // so a patchable chapter was a way to read another chapter's resources.
    rogueUpdate({ chapter: "Vancouver West" });
    expect(getViewer().chapter).toBe("Toronto Central");
  });
});

// Session-based cases run LAST: a request session can be entered but never
// cleared (enterWith has no undo), so it would leak into the tests above.
describe("chapter comes from the signed session", () => {
  const identity = { sub: "hosa_7", name: "Ada", chapter: "Vancouver West", role: "student" as const, exp: 9e9, iat: 0 };

  beforeEach(() => {
    setRequestSession({
      identity,
      viewer: { owner: identity.sub, chapter: identity.chapter, admin: false },
    });
  });

  it("seeds a new member's profile with their signed chapter", () => {
    expect(getProfile()).toMatchObject({ owner: "hosa_7", chapter: "Vancouver West" });
  });

  it("shows the signed chapter even when the stored record disagrees", () => {
    // Simulate a record written before chapter was locked down.
    rogueUpdate({ displayName: "Ada", chapter: "Somewhere Else" });
    expect(getProfile().chapter).toBe("Vancouver West");
  });

  it("heals the stored record on the next save", () => {
    rogueUpdate({ displayName: "Ada", chapter: "Somewhere Else" });
    expect(updateProfile({ bio: "loves EMT" }).chapter).toBe("Vancouver West");
  });
});

describe("admin comes from the signed session", () => {
  const admin = { sub: "admin_1", name: "Daniel", chapter: "HOSA Canada", role: "admin" as const, exp: 9e9, iat: 0 };

  it("grants admin for a signed admin identity", () => {
    setRequestSession({ identity: admin, viewer: { owner: admin.sub, chapter: admin.chapter, admin: true } });
    expect(getViewer().admin).toBe(true);
    expect(getProfile().role).toBe("admin");
  });

  it("a stored role can't outrank the session's", () => {
    // A record written before role was locked down still reads as the signed
    // role, and saving heals it.
    setRequestSession({
      identity: { ...admin, sub: "m_c", role: "student" },
      viewer: { owner: "m_c", chapter: admin.chapter, admin: false },
    });
    rogueUpdate({ displayName: "Casey", role: "admin" });
    expect(getProfile().role).toBe("student");
    expect(getViewer().admin).toBe(false);
  });
});
