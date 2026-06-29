import { describe, expect, it } from "vitest";

import { mintToken, verifyToken, DEFAULT_PERMS, TOKEN_VERSION } from "./token";

const SECRET = "test-secret-at-least-sixteen-chars-long";
const SRC = "https://bucket.example.com/doc.pdf?sig=abc";

describe("mintToken / verifyToken roundtrip", () => {
  it("mints a verifiable token carrying the claims", () => {
    const now = 1_000_000;
    const token = mintToken(SECRET, { src: SRC, watermark: "Daniel Liu", now });
    const res = verifyToken(SECRET, token, now + 10);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.claims.src).toBe(SRC);
    expect(res.claims.wm).toBe("Daniel Liu");
    expect(res.claims.perms).toEqual(DEFAULT_PERMS);
    expect(res.claims.exp).toBe(now + 900);
  });

  it("defaults permissions to fully locked down", () => {
    const token = mintToken(SECRET, { src: SRC });
    const res = verifyToken(SECRET, token);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.claims.perms).toEqual({ download: false, print: false, copy: false });
  });

  it("honours explicitly granted permissions", () => {
    const token = mintToken(SECRET, { src: SRC, perms: { download: true } });
    const res = verifyToken(SECRET, token);
    if (!res.ok) throw new Error("expected ok");
    expect(res.claims.perms).toEqual({ download: true, print: false, copy: false });
  });
});

describe("verifyToken rejections", () => {
  it("rejects a token signed with a different secret", () => {
    const token = mintToken(SECRET, { src: SRC });
    const res = verifyToken("a-completely-different-secret-value", token);
    expect(res).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("rejects a tampered payload", () => {
    const token = mintToken(SECRET, { src: SRC });
    const [v, payload, sig] = token.split(".");
    // Flip a character in the payload - signature no longer matches.
    const tampered = `${v}.${payload.slice(0, -1)}${payload.slice(-1) === "A" ? "B" : "A"}.${sig}`;
    expect(verifyToken(SECRET, tampered).ok).toBe(false);
  });

  it("rejects an expired token", () => {
    const now = 2_000_000;
    const token = mintToken(SECRET, { src: SRC, ttlSeconds: 60, now });
    expect(verifyToken(SECRET, token, now + 61)).toEqual({ ok: false, reason: "expired" });
    expect(verifyToken(SECRET, token, now + 59).ok).toBe(true);
  });

  it("rejects malformed tokens", () => {
    expect(verifyToken(SECRET, "garbage")).toMatchObject({ ok: false, reason: "malformed" });
    expect(verifyToken(SECRET, "a.b")).toMatchObject({ ok: false, reason: "malformed" });
    expect(verifyToken(SECRET, "v2.payload.sig")).toMatchObject({ ok: false, reason: "bad_version" });
  });

  it("clamps ttl into a sane range", () => {
    const now = 3_000_000;
    const tooLong = mintToken(SECRET, { src: SRC, ttlSeconds: 99_999, now });
    const tooShort = mintToken(SECRET, { src: SRC, ttlSeconds: 1, now });
    const long = verifyToken(SECRET, tooLong, now);
    const short = verifyToken(SECRET, tooShort, now);
    if (!long.ok || !short.ok) throw new Error("expected ok");
    expect(long.claims.exp).toBe(now + 3600);
    expect(short.claims.exp).toBe(now + 30);
  });
});

describe("mintToken guards", () => {
  it("refuses a weak secret", () => {
    expect(() => mintToken("short", { src: SRC })).toThrow(/at least 16/);
  });
  it("refuses a non-URL src", () => {
    expect(() => mintToken(SECRET, { src: "/relative/path" })).toThrow(/absolute/);
  });
  it("uses the current token version", () => {
    expect(mintToken(SECRET, { src: SRC }).startsWith(`${TOKEN_VERSION}.`)).toBe(true);
  });
});
