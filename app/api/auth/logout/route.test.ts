// Logout: clears the session cookie and audits an auth.signout for the departing
// member (read from the cookie BEFORE it is cleared).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn() }));

import { POST } from "./route";
import { recordAudit } from "@/lib/audit";
import { SESSION_COOKIE } from "@/lib/auth";
import { mintIdentityToken } from "@/lib/identity-token";

const SECRET = "shared-secret-at-least-16-chars";
const withCookie = (token?: string) =>
  new NextRequest("https://v.test/api/auth/logout", {
    method: "POST",
    headers: token ? { Cookie: `${SESSION_COOKIE}=${token}` } : {},
  });

beforeEach(() => {
  process.env.VITALS_AUTH_SECRET = SECRET;
  vi.clearAllMocks();
});
afterEach(() => {
  delete process.env.VITALS_AUTH_SECRET;
  vi.clearAllMocks();
});

describe("POST /api/auth/logout", () => {
  it("clears the cookie and audits the signout for the member", async () => {
    const token = mintIdentityToken(SECRET, { sub: "hosa_9", name: "Sam", chapter: "Toronto Central", role: "student" });
    const res = await POST(withCookie(token));
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
    // Deletion sets the cookie to an empty value.
    expect(res.cookies.get(SESSION_COOKIE)?.value).toBe("");
    expect(recordAudit).toHaveBeenCalledWith("auth.signout", "Sam", undefined, "hosa_9");
  });

  it("still succeeds with no session, and audits nothing", async () => {
    const res = await POST(withCookie());
    expect(res.status).toBe(200);
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("audits nothing for a tampered cookie", async () => {
    const res = await POST(withCookie("vid1.garbage.sig"));
    expect(res.status).toBe(200);
    expect(recordAudit).not.toHaveBeenCalled();
  });
});
