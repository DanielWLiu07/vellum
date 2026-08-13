import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { mintSessionToken, readIdentity, SESSION_TTL_SECONDS } from "./auth";
import { mintIdentityToken, verifyIdentityToken } from "./identity-token";
import { __resetProfile, getProfile, getViewer, type ProfilePatch, updateProfile } from "./profile";
import { setRequestSession } from "./request-context";

beforeEach(() => __resetProfile());

describe("getViewer session-awareness", () => {
  it("falls back to the local demo profile when there is no session", () => {
    // No session set -> the standalone demo identity ("you").
    expect(getViewer()).toEqual({ owner: "you", chapter: "Toronto Central", admin: false });
    // And it stays that way: this fallback viewer is exactly the one a
    // signed-out visitor gets, so neither chapter nor role may be patchable
    // here. The cast is what an attacker's request body looks like once it
    // reaches the store - ProfilePatch itself has no chapter.
    updateProfile({ displayName: "Rogue", chapter: "Elsewhere", role: "admin" } as ProfilePatch);
    expect(getViewer()).toEqual({ owner: "you", chapter: "Toronto Central", admin: false });
    expect(getProfile().displayName).toBe("Rogue"); // the legitimate part landed
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

describe("mintSessionToken", () => {
  const SECRET = "test-secret-at-least-16-chars";

  beforeEach(() => vi.stubEnv("VITALS_AUTH_SECRET", SECRET));
  afterEach(() => vi.unstubAllEnvs());

  /** A handoff token shaped like the one HOSA puts in the redirect URL. */
  const handoff = (ttlSeconds: number, extra: Record<string, unknown> = {}) =>
    mintIdentityToken(SECRET, {
      sub: "hosa_42",
      name: "Nina",
      chapter: "chp_abc123",
      role: "advisor",
      ttlSeconds,
      ...extra,
    });

  it("issues a different token than the one that arrived in the URL", () => {
    const url = handoff(60);
    const session = mintSessionToken(readIdentity(url)!);
    expect(session).not.toBe(url);
  });

  // The point of the split: a handoff token short enough that a leaked log
  // line is useless must still buy a full-length session.
  it("gives the session its own full lifetime, not the handoff token's", () => {
    const url = handoff(60);
    const urlExp = verifyIdentityToken(SECRET, url);
    const session = verifyIdentityToken(SECRET, mintSessionToken(readIdentity(url)!));

    expect(urlExp.ok && session.ok).toBe(true);
    if (!urlExp.ok || !session.ok) return;
    expect(urlExp.identity.exp - urlExp.identity.iat).toBe(60);
    expect(session.identity.exp - session.identity.iat).toBe(SESSION_TTL_SECONDS);
    expect(session.identity.exp).toBeGreaterThan(urlExp.identity.exp);
  });

  it("carries every identity claim across unchanged", () => {
    const id = readIdentity(handoff(60, { chapterName: "Toronto Central" }))!;
    const session = verifyIdentityToken(SECRET, mintSessionToken(id));
    expect(session.ok).toBe(true);
    if (!session.ok) return;
    expect(session.identity).toMatchObject({
      sub: "hosa_42",
      name: "Nina",
      chapter: "chp_abc123",
      chapterName: "Toronto Central",
      role: "advisor",
    });
  });

  it("omits chapterName when the handoff token had none", () => {
    const id = readIdentity(handoff(60))!;
    const session = verifyIdentityToken(SECRET, mintSessionToken(id));
    expect(session.ok).toBe(true);
    if (!session.ok) return;
    expect(session.identity.chapterName).toBeUndefined();
  });

  it("does not let a role be laundered into something unrecognised", () => {
    const id = readIdentity(handoff(60))!;
    const session = verifyIdentityToken(SECRET, mintSessionToken({ ...id, role: "student" }));
    expect(session.ok && session.identity.role).toBe("student");
  });
});
