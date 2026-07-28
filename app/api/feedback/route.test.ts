// Feedback API: anyone signed in can submit; listing + resolving is admin-only.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn() }));

import { GET, PATCH, POST } from "./route";
import { recordAudit } from "@/lib/audit";
import { SESSION_COOKIE } from "@/lib/auth";
import { __resetFeedback } from "@/lib/feedback";
import { mintIdentityToken } from "@/lib/identity-token";
import { __resetProfile } from "@/lib/profile";
import { __resetRateLimit } from "@/lib/rate-limit";

// Admin comes from the signed session, never from the local profile (role isn't
// patchable — that was a self-escalation path). MEMBER keeps the "you" owner key
// the standalone demo profile uses, so a report they file is reported by "you".
const SECRET = "shared-secret-at-least-16-chars";
const MEMBER = { sub: "you", name: "You", chapter: "Toronto Central", role: "student" } as const;
const ADMIN = { sub: "admin_1", name: "Daniel Liu", chapter: "HOSA Canada", role: "admin" } as const;
type Person = typeof MEMBER | typeof ADMIN;
const cookie = (p: Person) => `${SESSION_COOKIE}=${mintIdentityToken(SECRET, { ...p })}`;

const post = (body: unknown) =>
  POST(new NextRequest("https://v.test/api/feedback", { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json", Cookie: cookie(MEMBER) } }));
const get = (who: Person) => GET(new NextRequest("https://v.test/api/feedback", { headers: { Cookie: cookie(who) } }));
const patch = (who: Person, body: unknown) =>
  PATCH(new NextRequest("https://v.test/api/feedback", { method: "PATCH", body: JSON.stringify(body), headers: { "Content-Type": "application/json", Cookie: cookie(who) } }));

beforeEach(() => {
  process.env.VELLUM_DEMO_MODE = "1";
  process.env.VITALS_AUTH_SECRET = SECRET;
  __resetFeedback();
  __resetProfile();
  __resetRateLimit();
});
afterEach(() => {
  delete process.env.VELLUM_DEMO_MODE;
  delete process.env.VITALS_AUTH_SECRET;
  vi.clearAllMocks();
});

describe("POST /api/feedback", () => {
  it("accepts a report and audits it", async () => {
    const res = await post({ kind: "bug", message: "The buzzer timer froze." });
    expect(res.status).toBe(200);
    expect((await res.json()).id).toMatch(/^fb_/);
    expect(recordAudit).toHaveBeenCalledWith("feedback.submit", "bug", undefined, "you");
  });

  it("rejects an empty message", async () => {
    expect((await post({ kind: "idea", message: "   " })).status).toBe(400);
  });

  it("404s when the dashboard is disabled", async () => {
    delete process.env.VELLUM_DEMO_MODE;
    expect((await post({ kind: "bug", message: "x" })).status).toBe(404);
  });
});

describe("GET /api/feedback (admin only)", () => {
  it("403s a non-admin", async () => {
    await post({ kind: "bug", message: "hi" });
    expect((await get(MEMBER)).status).toBe(403);
  });

  it("lists reports for an admin, newest-first", async () => {
    await post({ kind: "bug", message: "first" });
    await post({ kind: "idea", message: "second" });
    const j = await (await get(ADMIN)).json();
    expect(j.feedback).toHaveLength(2);
    expect(j.feedback[0].message).toBe("second");
  });
});

describe("PATCH /api/feedback (admin only)", () => {
  it("resolves and reopens a report", async () => {
    const id = (await (await post({ kind: "bug", message: "resolve me" })).json()).id;
    expect((await (await patch(ADMIN, { id, resolved: true })).json()).feedback.resolved).toBe(true);
    expect((await (await patch(ADMIN, { id, resolved: false })).json()).feedback.resolved).toBe(false);
  });

  it("403s a non-admin and 404s an unknown id for an admin", async () => {
    const id = (await (await post({ kind: "bug", message: "x" })).json()).id;
    expect((await patch(MEMBER, { id, resolved: true })).status).toBe(403);
    expect((await patch(ADMIN, { id: "nope", resolved: true })).status).toBe(404);
  });
});
