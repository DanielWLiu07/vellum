import { beforeEach, describe, expect, it } from "vitest";

import { __resetProfile, getProfile, getViewer, OWNER_KEY, PROFILE_LIMITS, updateProfile } from "./profile";

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

  it("accepts known roles and ignores unknown ones", () => {
    updateProfile({ role: "advisor" });
    expect(getProfile().role).toBe("advisor");
    updateProfile({ role: "wizard" });
    expect(getProfile().role).toBe("advisor"); // unchanged
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

describe("getViewer (profile is the source of truth)", () => {
  it("mirrors the seed by default (matches the old DEMO_VIEWER)", () => {
    expect(getViewer()).toEqual({ owner: OWNER_KEY, chapter: "Toronto Central", admin: false });
  });

  it("grants admin only for the admin role", () => {
    updateProfile({ role: "trainer" });
    expect(getViewer().admin).toBe(false);
    updateProfile({ role: "admin" });
    expect(getViewer().admin).toBe(true);
  });

  it("reflects the edited chapter (access scope follows the profile)", () => {
    updateProfile({ chapter: "Vancouver West" });
    expect(getViewer().chapter).toBe("Vancouver West");
  });

  it("keeps the owner key stable across edits (existing resources stay owned)", () => {
    updateProfile({ displayName: "New Name", chapter: "Elsewhere", role: "admin" });
    expect(getViewer().owner).toBe(OWNER_KEY);
  });
});
