// Demo sign-in: mints an identity token locally (stands in for the HOSA handoff),
// sets the session cookie, audits an auth.signin, and redirects. Demo-mode only.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn() }));

import { GET } from "./route";
import { recordAudit } from "@/lib/audit";
import { SESSION_COOKIE } from "@/lib/auth";

const SECRET = "shared-secret-at-least-16-chars";
const call = (as?: string) =>
  GET(new NextRequest(`https://v.test/api/auth/demo${as ? `?as=${as}` : ""}`));

// Demo sign-in has its OWN flag. VELLUM_DEMO_MODE turns the study platform on;
// this endpoint mints an admin session for any anonymous caller (?as=admin), so
// it stays shut unless VELLUM_DEMO_SIGNIN is set too.
beforeEach(() => {
  process.env.VELLUM_DEMO_MODE = "1";
  process.env.VELLUM_DEMO_SIGNIN = "1";
  process.env.VITALS_AUTH_SECRET = SECRET;
  vi.clearAllMocks();
});
afterEach(() => {
  delete process.env.VELLUM_DEMO_MODE;
  delete process.env.VELLUM_DEMO_SIGNIN;
  delete process.env.VITALS_AUTH_SECRET;
  vi.clearAllMocks();
});

describe("GET /api/auth/demo", () => {
  it("signs in a demo admin: sets the cookie, audits, redirects", async () => {
    const res = await call("admin");
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/dashboard");
    expect(res.cookies.get(SESSION_COOKIE)?.httpOnly).toBe(true);
    expect(recordAudit).toHaveBeenCalledWith("auth.signin", "Demo Admin", undefined, "demo_admin");
  });

  it("defaults to the student role for an unknown 'as'", async () => {
    await call("wizard");
    expect(recordAudit).toHaveBeenCalledWith("auth.signin", "Demo Student", undefined, "demo_student");
  });

  it("honors a same-origin ?next= landing", async () => {
    const res = await GET(new NextRequest("https://v.test/api/auth/demo?as=admin&next=/modules/m_1/edit"));
    expect(res.headers.get("location")).toContain("/modules/m_1/edit");
  });

  it("ignores an open-redirect ?next= (protocol-relative or absolute)", async () => {
    for (const bad of ["//evil.com", "https://evil.com", "javascript:alert(1)"]) {
      const res = await GET(new NextRequest(`https://v.test/api/auth/demo?as=admin&next=${encodeURIComponent(bad)}`));
      expect(res.headers.get("location")).toContain("/dashboard");
    }
  });

  it("404s when demo sign-in is off (and audits nothing)", async () => {
    delete process.env.VELLUM_DEMO_SIGNIN;
    expect((await call("admin")).status).toBe(404);
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("stays shut for a real deployment: demo mode alone doesn't open it", async () => {
    // The gate that matters. VELLUM_DEMO_MODE=1 is how HOSA runs the study
    // platform in production; if that also enabled this route, every anonymous
    // caller could mint themselves an admin session with ?as=admin.
    delete process.env.VELLUM_DEMO_SIGNIN;
    process.env.VELLUM_DEMO_MODE = "1";
    const res = await call("admin");
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("demo_disabled");
    expect(res.cookies.get(SESSION_COOKIE)).toBeUndefined();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("500s when the shared secret is missing", async () => {
    delete process.env.VITALS_AUTH_SECRET;
    expect((await call("admin")).status).toBe(500);
  });
});
