// Folders API: list (official + own), create (official is admin-only, names
// moderated), and the standard guards.

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
import { __resetFolders } from "@/lib/folders";
import { __resetProfile, updateProfile } from "@/lib/profile";
import { __resetRateLimit } from "@/lib/rate-limit";

const ALLOWED = { allowed: true, flagged: false, categories: [], checked: true };
const FLAGGED = { allowed: false, flagged: true, categories: ["hate"], checked: true };

const postReq = (body: unknown) =>
  new NextRequest("https://v.test/api/folders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  process.env.VELLUM_DEMO_MODE = "1";
  __resetFolders();
  __resetProfile();
  __resetRateLimit();
  moderateText.mockResolvedValue(ALLOWED);
});
afterEach(() => {
  delete process.env.VELLUM_DEMO_MODE;
  vi.clearAllMocks();
});

describe("folders API", () => {
  it("creates a personal folder and lists it", async () => {
    const res = await POST(postReq({ name: "My study set" }));
    expect(res.status).toBe(200);
    const list = await (await GET(new NextRequest("https://v.test/x"))).json();
    expect(list.folders.map((f: { name: string }) => f.name)).toContain("My study set");
  });

  it("blocks a non-admin from creating an official folder", async () => {
    const res = await POST(postReq({ name: "Official EMT", official: true }));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("admin_only");
  });

  it("lets an admin create an official folder", async () => {
    updateProfile({ role: "admin" });
    const res = await POST(postReq({ name: "Official EMT", official: true }));
    expect(res.status).toBe(200);
    expect((await res.json()).folder.official).toBe(true);
  });

  it("moderates the folder name", async () => {
    moderateText.mockResolvedValue(FLAGGED);
    const res = await POST(postReq({ name: "hateful folder" }));
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe("content_flagged");
  });

  it("rejects an empty name", async () => {
    expect((await POST(postReq({ name: "  " }))).status).toBe(400);
  });

  it("404s when the dashboard is disabled", async () => {
    delete process.env.VELLUM_DEMO_MODE;
    expect((await GET(new NextRequest("https://v.test/x"))).status).toBe(404);
  });
});
