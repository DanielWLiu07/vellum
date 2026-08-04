import { beforeEach, describe, expect, it } from "vitest";

import {
  __resetShareBans,
  banPublicSharing,
  getShareBan,
  isPublicSharingBanned,
  liftPublicShareBan,
  listShareBans,
} from "./share-ban";

beforeEach(() => __resetShareBans());

describe("public-sharing ban", () => {
  it("treats an unknown owner as unbanned", () => {
    expect(isPublicSharingBanned("nobody")).toBe(false);
    expect(getShareBan("nobody")).toBeUndefined();
  });

  it("records who imposed it and why", () => {
    const ban = banPublicSharing("ava", "admin", "repeat uploads after review");
    expect(isPublicSharingBanned("ava")).toBe(true);
    expect(ban.by).toBe("admin");
    expect(ban.reason).toBe("repeat uploads after review");
    expect(ban.at).toBeTypeOf("number");
  });

  it("refreshes the reason when an already-banned owner is re-banned", () => {
    banPublicSharing("ava", "admin", "first");
    banPublicSharing("ava", "other-admin", "second");
    expect(getShareBan("ava")).toMatchObject({ by: "other-admin", reason: "second" });
    expect(listShareBans()).toHaveLength(1);
  });

  it("lifts a ban and reports whether one was actually in place", () => {
    banPublicSharing("ava", "admin");
    expect(liftPublicShareBan("ava")).toBe(true);
    expect(isPublicSharingBanned("ava")).toBe(false);
    expect(liftPublicShareBan("ava")).toBe(false);
  });

  it("clamps an overlong reason", () => {
    expect(banPublicSharing("ava", "admin", "x".repeat(900)).reason.length).toBe(500);
  });

  it("lists active bans newest first, and never lists a lifted one", () => {
    banPublicSharing("ava", "admin");
    banPublicSharing("ben", "admin");
    expect(listShareBans().map((b) => b.owner)).toContain("ava");
    liftPublicShareBan("ava");
    expect(listShareBans().map((b) => b.owner)).toEqual(["ben"]);
  });
});
