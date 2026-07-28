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
import { SESSION_COOKIE } from "@/lib/auth";
import { mintIdentityToken } from "@/lib/identity-token";
import { __resetModules } from "@/lib/modules";
import { __resetProfile } from "@/lib/profile";

const ALLOWED = { allowed: true, flagged: false, categories: [], checked: true };
const FLAGGED = { allowed: false, flagged: true, categories: ["hate"], checked: true };

// Admin comes from the signed session, never from the local profile (role isn't
// patchable — that was a self-escalation path). MEMBER keeps the "you" owner key
// the standalone demo profile uses, so seeded fixtures stay the member's own.
const SECRET = "shared-secret-at-least-16-chars";
const MEMBER = { sub: "you", name: "You", chapter: "Toronto Central", role: "student" } as const;
const ADMIN = { sub: "admin_1", name: "Daniel Liu", chapter: "HOSA Canada", role: "admin" } as const;
type Person = typeof MEMBER | typeof ADMIN;
const cookie = (p: Person) => `${SESSION_COOKIE}=${mintIdentityToken(SECRET, { ...p })}`;

const post = (who: Person, body: unknown) =>
  POST(new NextRequest("https://v.test/api/modules", { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json", Cookie: cookie(who) } }));
const get = () => GET(new NextRequest("https://v.test/api/modules", { headers: { Cookie: cookie(MEMBER) } }));

beforeEach(() => {
  process.env.VELLUM_DEMO_MODE = "1";
  process.env.VITALS_AUTH_SECRET = SECRET;
  __resetModules();
  __resetProfile();
  moderateText.mockResolvedValue(ALLOWED);
});
afterEach(() => {
  delete process.env.VELLUM_DEMO_MODE;
  delete process.env.VITALS_AUTH_SECRET;
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
    expect((await post(MEMBER, { title: "New" })).status).toBe(403);
  });

  it("creates a module for an admin", async () => {
    const res = await post(ADMIN, { title: "Airway Management" });
    expect(res.status).toBe(200);
    expect((await res.json()).title).toBe("Airway Management");
  });

  it("blocks a flagged title (422)", async () => {
    moderateText.mockResolvedValue(FLAGGED);
    expect((await post(ADMIN, { title: "hateful module" })).status).toBe(422);
  });
});
