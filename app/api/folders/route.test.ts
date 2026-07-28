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
import { SESSION_COOKIE } from "@/lib/auth";
import { __resetFolders } from "@/lib/folders";
import { mintIdentityToken } from "@/lib/identity-token";
import { __resetProfile } from "@/lib/profile";
import { __resetRateLimit } from "@/lib/rate-limit";

const ALLOWED = { allowed: true, flagged: false, categories: [], checked: true };
const FLAGGED = { allowed: false, flagged: true, categories: ["hate"], checked: true };

// Admin comes from the signed session, never from the local profile (role isn't
// patchable — that was a self-escalation path). MEMBER keeps the "you" owner key
// the standalone demo profile uses, so folders they create stay theirs.
const SECRET = "shared-secret-at-least-16-chars";
const MEMBER = { sub: "you", name: "You", chapter: "Toronto Central", role: "student" } as const;
const ADMIN = { sub: "admin_1", name: "Daniel Liu", chapter: "HOSA Canada", role: "admin" } as const;
type Person = typeof MEMBER | typeof ADMIN;
const cookie = (p: Person) => `${SESSION_COOKIE}=${mintIdentityToken(SECRET, { ...p })}`;

const postReq = (who: Person, body: unknown) =>
  new NextRequest("https://v.test/api/folders", {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie(who) },
    body: JSON.stringify(body),
  });
const listReq = (who: Person = MEMBER) =>
  new NextRequest("https://v.test/api/folders", { headers: { Cookie: cookie(who) } });

beforeEach(() => {
  process.env.VELLUM_DEMO_MODE = "1";
  process.env.VITALS_AUTH_SECRET = SECRET;
  __resetFolders();
  __resetProfile();
  __resetRateLimit();
  moderateText.mockResolvedValue(ALLOWED);
});
afterEach(() => {
  delete process.env.VELLUM_DEMO_MODE;
  delete process.env.VITALS_AUTH_SECRET;
  vi.clearAllMocks();
});

describe("folders API", () => {
  it("creates a personal folder and lists it", async () => {
    const res = await POST(postReq(MEMBER, { name: "My study set" }));
    expect(res.status).toBe(200);
    const list = await (await GET(listReq())).json();
    expect(list.folders.map((f: { name: string }) => f.name)).toContain("My study set");
  });

  it("blocks a non-admin from creating an official folder", async () => {
    const res = await POST(postReq(MEMBER, { name: "Official EMT", official: true }));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("admin_only");
  });

  it("lets an admin create an official folder", async () => {
    const res = await POST(postReq(ADMIN, { name: "Official EMT", official: true }));
    expect(res.status).toBe(200);
    expect((await res.json()).folder.official).toBe(true);
  });

  it("moderates the folder name", async () => {
    moderateText.mockResolvedValue(FLAGGED);
    const res = await POST(postReq(MEMBER, { name: "hateful folder" }));
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe("content_flagged");
  });

  it("rejects an empty name", async () => {
    expect((await POST(postReq(MEMBER, { name: "  " }))).status).toBe(400);
  });

  it("404s when the dashboard is disabled", async () => {
    delete process.env.VELLUM_DEMO_MODE;
    expect((await GET(listReq())).status).toBe(404);
  });
});
