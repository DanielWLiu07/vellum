import { beforeEach, describe, expect, it } from "vitest";

import { __resetProfile, getProfile, getViewer, updateProfile } from "./profile";
import { setRequestSession } from "./request-context";

beforeEach(() => __resetProfile());

describe("getViewer session-awareness", () => {
  it("falls back to the local demo profile when there is no session", () => {
    // No session set -> the standalone demo identity ("you").
    expect(getViewer()).toEqual({ owner: "you", chapter: "Toronto Central", admin: false });
    updateProfile({ chapter: "Elsewhere", role: "admin" });
    expect(getViewer()).toEqual({ owner: "you", chapter: "Elsewhere", admin: true });
  });

  it("uses the authenticated HOSA member when a session is present", () => {
    setRequestSession({
      identity: { sub: "hosa_9", name: "Nina", chapter: "Vancouver West", role: "admin", exp: 9e9, iat: 0 },
      viewer: { owner: "hosa_9", chapter: "Vancouver West", admin: true },
    });
    // The session identity wins over the local profile.
    expect(getViewer()).toEqual({ owner: "hosa_9", chapter: "Vancouver West", admin: true });
  });
});

describe("per-member profiles", () => {
  it("keeps each member's profile separate, seeded from their session", () => {
    // Member A edits their name.
    setRequestSession({
      identity: { sub: "m_a", name: "A", chapter: "X", role: "student", exp: 9e9, iat: 0 },
      viewer: { owner: "m_a", chapter: "X", admin: false },
    });
    updateProfile({ displayName: "Ava", bio: "loves EMT" });
    expect(getProfile()).toMatchObject({ owner: "m_a", displayName: "Ava", bio: "loves EMT" });

    // Member B signs in -> their OWN profile, seeded from their session name,
    // not Ava's.
    setRequestSession({
      identity: { sub: "m_b", name: "Bianca", chapter: "Y", role: "advisor", exp: 9e9, iat: 0 },
      viewer: { owner: "m_b", chapter: "Y", admin: false },
    });
    expect(getProfile()).toMatchObject({ owner: "m_b", displayName: "Bianca", bio: "" });
  });
});
