// Feedback API: anyone signed in can submit; listing + resolving is admin-only.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn() }));

import { GET, PATCH, POST } from "./route";
import { recordAudit } from "@/lib/audit";
import { __resetFeedback } from "@/lib/feedback";
import { __resetProfile, updateProfile } from "@/lib/profile";
import { __resetRateLimit } from "@/lib/rate-limit";

const post = (body: unknown) =>
  POST(new NextRequest("https://v.test/api/feedback", { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }));
const get = () => GET(new NextRequest("https://v.test/api/feedback"));
const patch = (body: unknown) =>
  PATCH(new NextRequest("https://v.test/api/feedback", { method: "PATCH", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }));

beforeEach(() => {
  process.env.VELLUM_DEMO_MODE = "1";
  __resetFeedback();
  __resetProfile();
  __resetRateLimit();
});
afterEach(() => {
  delete process.env.VELLUM_DEMO_MODE;
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
    expect((await get()).status).toBe(403);
  });

  it("lists reports for an admin, newest-first", async () => {
    await post({ kind: "bug", message: "first" });
    await post({ kind: "idea", message: "second" });
    updateProfile({ role: "admin" });
    const j = await (await get()).json();
    expect(j.feedback).toHaveLength(2);
    expect(j.feedback[0].message).toBe("second");
  });
});

describe("PATCH /api/feedback (admin only)", () => {
  it("resolves and reopens a report", async () => {
    const id = (await (await post({ kind: "bug", message: "resolve me" })).json()).id;
    updateProfile({ role: "admin" });
    expect((await (await patch({ id, resolved: true })).json()).feedback.resolved).toBe(true);
    expect((await (await patch({ id, resolved: false })).json()).feedback.resolved).toBe(false);
  });

  it("403s a non-admin and 404s an unknown id for an admin", async () => {
    const id = (await (await post({ kind: "bug", message: "x" })).json()).id;
    expect((await patch({ id, resolved: true })).status).toBe(403);
    updateProfile({ role: "admin" });
    expect((await patch({ id: "nope", resolved: true })).status).toBe(404);
  });
});
