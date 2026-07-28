import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import { mintIdentityToken, verifyIdentityToken } from "./identity-token";

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
