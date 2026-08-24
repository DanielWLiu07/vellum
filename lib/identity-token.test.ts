import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import { mintIdentityToken, verifyIdentityToken } from "./identity-token";
import { SESSION_TTL_SECONDS } from "./auth";

const SECRET = "shared-secret-at-least-16-chars";

describe("identity token", () => {
  it("round-trips a member identity", () => {
    const t = mintIdentityToken(SECRET, { sub: "u_42", name: "Priya Sharma", chapter: "Toronto Central", role: "advisor" });
    const r = verifyIdentityToken(SECRET, t);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.identity.sub).toBe("u_42");
      expect(r.identity.name).toBe("Priya Sharma");
      expect(r.identity.chapter).toBe("Toronto Central");
      expect(r.identity.role).toBe("advisor");
    }
  });

  it("defaults an unknown/omitted role to student", () => {
    const r = verifyIdentityToken(SECRET, mintIdentityToken(SECRET, { sub: "u_1" }));
    expect(r.ok && r.identity.role).toBe("student");
  });

  it("rejects a token signed with a DIFFERENT secret", () => {
    const t = mintIdentityToken(SECRET, { sub: "u_1", role: "admin" });
    const r = verifyIdentityToken("a-totally-different-secret-16", t);
    expect(r).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("rejects a tampered payload (e.g. privilege bump)", () => {
    const t = mintIdentityToken(SECRET, { sub: "u_1", role: "student" });
    const [v, payload, sig] = t.split(".");
    // Flip a character in the payload; the signature no longer matches.
    const flipped = payload.slice(0, -1) + (payload.at(-1) === "A" ? "B" : "A");
    expect(verifyIdentityToken(SECRET, `${v}.${flipped}.${sig}`).ok).toBe(false);
  });

  it("rejects an expired token", () => {
    const t = mintIdentityToken(SECRET, { sub: "u_1", ttlSeconds: 60, now: 1000 });
    expect(verifyIdentityToken(SECRET, t, 2000)).toEqual({ ok: false, reason: "expired" });
    expect(verifyIdentityToken(SECRET, t, 1030).ok).toBe(true); // still valid mid-window
  });

  it("rejects malformed / non-string input", () => {
    expect(verifyIdentityToken(SECRET, "not-a-token").ok).toBe(false);
    expect(verifyIdentityToken(SECRET, 123 as unknown).ok).toBe(false);
    expect(verifyIdentityToken(SECRET, "v9.x.y").ok).toBe(false);
  });

  it("refuses to mint without a sub or a strong secret", () => {
    expect(() => mintIdentityToken("short", { sub: "u_1" })).toThrow();
    expect(() => mintIdentityToken(SECRET, { sub: "" })).toThrow();
  });
});

// The chapter arrives as TWO fields: `chapter` is the host app's chapter id
// (the grouping/scoping key, compared against stored values) and `chapterName`
// is the human-readable name for display. HOSA sends a cuid as `chapter`, so
// rendering it directly showed students something like "clx3k2p9f0001…".
describe("chapter identity vs chapter display name", () => {
  it("round-trips both fields", () => {
    const t = mintIdentityToken(SECRET, {
      sub: "u_7",
      chapter: "clx3k2p9f0001abcd",
      chapterName: "Toronto Central",
    });
    const r = verifyIdentityToken(SECRET, t);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.identity.chapter).toBe("clx3k2p9f0001abcd");
      expect(r.identity.chapterName).toBe("Toronto Central");
    }
  });

  it("clamps the display name to 80 chars", () => {
    const r = verifyIdentityToken(
      SECRET,
      mintIdentityToken(SECRET, { sub: "u_8", chapter: "c_1", chapterName: "N".repeat(200) }),
    );
    expect(r.ok && r.identity.chapterName).toHaveLength(80);
  });

  it("BACKWARD COMPAT: a token minted WITHOUT chapterName still verifies", () => {
    // An 8h token issued before this field existed must keep working. This is
    // that token — nothing sets chapterName — and readers fall back to the id.
    const old = mintIdentityToken(SECRET, { sub: "u_9", chapter: "c_legacy", role: "advisor" });
    const r = verifyIdentityToken(SECRET, old);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.identity.chapter).toBe("c_legacy");
      expect(r.identity.chapterName).toBeUndefined();
      // The documented fallback every consumer uses.
      expect(r.identity.chapterName || r.identity.chapter).toBe("c_legacy");
    }
  });

  it("omits chapterName entirely when there's no name to send", () => {
    // Keeps a chapter-less token byte-identical in shape to a pre-change one.
    const t = mintIdentityToken(SECRET, { sub: "u_10", chapter: "c_1", chapterName: "" });
    const payload = JSON.parse(
      Buffer.from(t.split(".")[1]!.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"),
    );
    expect("chapterName" in payload).toBe(false);
  });

  it("drops a non-string chapterName rather than handing it to consumers", () => {
    // Hand-sign a payload the minter would never produce, so this exercises
    // verify's own coercion rather than the minter's clamping.
    const b64url = (b: Buffer) =>
      b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const payload = b64url(
      Buffer.from(
        JSON.stringify({
          sub: "u_11",
          name: "",
          chapter: "c_1",
          chapterName: 42,
          role: "student",
          exp: Math.floor(Date.now() / 1000) + 600,
          iat: Math.floor(Date.now() / 1000),
        }),
        "utf8",
      ),
    );
    const input = `vid1.${payload}`;
    const sig = b64url(createHmac("sha256", SECRET).update(input).digest());

    const r = verifyIdentityToken(SECRET, `${input}.${sig}`);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.identity.chapterName).toBeUndefined();
      expect(r.identity.chapterName || r.identity.chapter).toBe("c_1");
    }
  });
});

// The invariant S13.3's warning depends on.
//
// The roadmap says the handoff TTL "must not be cut until the member platform's
// handoff is redeployed in step, or every session dies on arrival". That is
// only true if the Vitals SESSION inherits the handoff token's expiry. It does
// not: /api/auth/enter verifies the incoming token and then mints a FRESH
// session on SESSION_TTL_SECONDS. Cutting the mint TTL is therefore a
// one-sided change on the platform, and these tests are here so that stays
// true - if someone makes the session inherit `exp`, this fails.
describe("handoff TTL is independent of session TTL", () => {
  const SHORT_SECRET = "a-test-secret-at-least-16-chars";
  const who = { sub: "m_ttl", name: "Ada", chapter: "c_1", role: "student" as const };

  it("a 60-second handoff token verifies immediately", () => {
    const t = mintIdentityToken(SHORT_SECRET, { ...who, ttlSeconds: 60 });
    expect(verifyIdentityToken(SHORT_SECRET, t).ok).toBe(true);
  });

  it("and is refused a minute later", () => {
    const t = mintIdentityToken(SHORT_SECRET, { ...who, ttlSeconds: 60 });
    expect(verifyIdentityToken(SHORT_SECRET, t, Math.floor(Date.now() / 1000) + 61).ok).toBe(false);
  });

  it("the session it produces outlives it by hours", () => {
    // mintSessionToken mints on SESSION_TTL_SECONDS, never on the incoming
    // token's exp - so the session length is this constant and nothing else.
    expect(SESSION_TTL_SECONDS).toBe(8 * 3600);
    const handoff = verifyIdentityToken(SHORT_SECRET, mintIdentityToken(SHORT_SECRET, { ...who, ttlSeconds: 60 }));
    const session = verifyIdentityToken(
      SHORT_SECRET,
      mintIdentityToken(SHORT_SECRET, { ...who, ttlSeconds: SESSION_TTL_SECONDS }),
    );
    expect(handoff.ok && session.ok).toBe(true);
    if (!handoff.ok || !session.ok) return;
    expect(session.identity.exp - handoff.identity.exp).toBeGreaterThan(7 * 3600);
  });
});
