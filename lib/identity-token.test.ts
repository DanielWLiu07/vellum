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
