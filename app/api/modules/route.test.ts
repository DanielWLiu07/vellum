// Modules API: anyone browses (GET list); creating is admin-only and moderated.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { moderateText } = vi.hoisted(() => ({ moderateText: vi.fn() }));
vi.mock("@/lib/moderation", () => ({
  moderateText,
  moderationConfigured: () => true,
  flaggedReason: (r: { categories: string[] }) => r.categories.join(", "),
}));
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn() }));

import { GET, POST } from "./route";
import { __resetModules } from "@/lib/modules";
import { __resetProfile, updateProfile } from "@/lib/profile";

const ALLOWED = { allowed: true, flagged: false, categories: [], checked: true };
const FLAGGED = { allowed: false, flagged: true, categories: ["hate"], checked: true };

const post = (body: unknown) =>
  POST(new NextRequest("https://v.test/api/modules", { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }));
const get = () => GET(new NextRequest("https://v.test/api/modules"));

beforeEach(() => {
  process.env.VELLUM_DEMO_MODE = "1";
  __resetModules();
  __resetProfile();
  moderateText.mockResolvedValue(ALLOWED);
});
afterEach(() => {
  delete process.env.VELLUM_DEMO_MODE;
  vi.clearAllMocks();
});

describe("GET /api/modules", () => {
  it("lists modules for any signed-in member", async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(Array.isArray((await res.json()).modules)).toBe(true);
  });
});

describe("POST /api/modules (admin only)", () => {
  it("403s a non-admin", async () => {
    expect((await post({ title: "New" })).status).toBe(403);
  });

  it("creates a module for an admin", async () => {
    updateProfile({ role: "admin" });
    const res = await post({ title: "Airway Management" });
    expect(res.status).toBe(200);
    expect((await res.json()).title).toBe("Airway Management");
  });

  it("blocks a flagged title (422)", async () => {
    updateProfile({ role: "admin" });
    moderateText.mockResolvedValue(FLAGGED);
    expect((await post({ title: "hateful module" })).status).toBe(422);
  });
});
