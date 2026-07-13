// The HOSA handoff: /api/auth/enter verifies a signed identity token, sets the
// session cookie, and redirects to the dashboard. A bad token is rejected.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";

import { GET as enter } from "./enter/route";
import { SESSION_COOKIE } from "@/lib/auth";
import { mintIdentityToken } from "@/lib/identity-token";
import { listAudit } from "@/lib/audit";

const SECRET = "shared-secret-at-least-16-chars";

const enterReq = (token: string | null) =>
  enter(new NextRequest(`https://v.test/api/auth/enter${token === null ? "" : `?token=${encodeURIComponent(token)}`}`));

beforeEach(() => { process.env.VITALS_AUTH_SECRET = SECRET; });
afterEach(() => { delete process.env.VITALS_AUTH_SECRET; });

describe("GET /api/auth/enter", () => {
  it("accepts a valid HOSA token: sets the session cookie and redirects to /dashboard", async () => {
    const token = mintIdentityToken(SECRET, { sub: "hosa_7", name: "Priya", chapter: "Toronto Central", role: "advisor" });
    const res = await enterReq(token);
    expect(res.status).toBe(307); // redirect
    expect(res.headers.get("location")).toContain("/dashboard");
    const cookie = res.cookies.get(SESSION_COOKIE);
    expect(cookie?.value).toBe(token);
    expect(cookie?.httpOnly).toBe(true);
  });

  it("audits an auth.signin for the entering member", async () => {
    const token = mintIdentityToken(SECRET, { sub: "hosa_42", name: "Ada", chapter: "Toronto Central", role: "student" });
    await enterReq(token);
    const top = listAudit()[0];
    expect(top?.action).toBe("auth.signin");
    expect(top?.actor).toBe("hosa_42");
    expect(top?.target).toBe("Ada");
  });

  it("rejects a token signed with the wrong secret (401, no cookie)", async () => {
    const token = mintIdentityToken("some-other-secret-16chars!!", { sub: "attacker", role: "admin" });
    const res = await enterReq(token);
    expect(res.status).toBe(401);
    expect(res.cookies.get(SESSION_COOKIE)).toBeUndefined();
  });

  it("rejects a missing token", async () => {
    expect((await enterReq(null)).status).toBe(401);
  });
});
