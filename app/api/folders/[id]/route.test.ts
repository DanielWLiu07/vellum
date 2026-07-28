// Folder rename/delete API: only the owner (or an admin for official folders)
// may manage a folder; rename names are moderated.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { moderateText } = vi.hoisted(() => ({ moderateText: vi.fn() }));
vi.mock("@/lib/moderation", () => ({
  moderateText,
  moderationConfigured: () => true,
  flaggedReason: (r: { categories: string[] }) => r.categories.join(", "),
}));
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn() }));

import { DELETE, PATCH } from "./route";
import { SESSION_COOKIE } from "@/lib/auth";
import { __resetFolders, createFolder, getFolder } from "@/lib/folders";
import { mintIdentityToken } from "@/lib/identity-token";
import { __resetProfile } from "@/lib/profile";

const ALLOWED = { allowed: true, flagged: false, categories: [], checked: true };
const FLAGGED = { allowed: false, flagged: true, categories: ["hate"], checked: true };

// Admin comes from the signed session, never from the local profile (role isn't
// patchable — that was a self-escalation path). MEMBER keeps the "you" owner key
// the fixtures below are seeded with, so "the owner" really is the caller.
const SECRET = "shared-secret-at-least-16-chars";
const MEMBER = { sub: "you", name: "You", chapter: "Toronto Central", role: "student" } as const;
const ADMIN = { sub: "admin_1", name: "Daniel Liu", chapter: "HOSA Canada", role: "admin" } as const;
type Person = typeof MEMBER | typeof ADMIN;
const cookie = (p: Person) => `${SESSION_COOKIE}=${mintIdentityToken(SECRET, { ...p })}`;

const patch = (who: Person, id: string, body: unknown) =>
  PATCH(
    new NextRequest(`https://v.test/api/folders/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json", Cookie: cookie(who) },
    }),
    { params: Promise.resolve({ id }) },
  );
const del = (who: Person, id: string) =>
  DELETE(
    new NextRequest(`https://v.test/api/folders/${id}`, { method: "DELETE", headers: { Cookie: cookie(who) } }),
    { params: Promise.resolve({ id }) },
  );

beforeEach(() => {
  process.env.VELLUM_DEMO_MODE = "1";
  process.env.VITALS_AUTH_SECRET = SECRET;
  __resetFolders();
  __resetProfile();
  moderateText.mockResolvedValue(ALLOWED);
});
afterEach(() => {
  delete process.env.VELLUM_DEMO_MODE;
  delete process.env.VITALS_AUTH_SECRET;
  vi.clearAllMocks();
});

describe("PATCH /api/folders/[id]", () => {
  it("renames the owner's folder", async () => {
    const f = createFolder("Old", "you", false);
    const res = await patch(MEMBER, f.id, { name: "New" });
    expect(res.status).toBe(200);
    expect((await res.json()).folder.name).toBe("New");
    expect(getFolder(f.id)!.name).toBe("New");
  });

  it("moderates the new name", async () => {
    const f = createFolder("Old", "you", false);
    moderateText.mockResolvedValue(FLAGGED);
    const res = await patch(MEMBER, f.id, { name: "hateful" });
    expect(res.status).toBe(422);
    expect(getFolder(f.id)!.name).toBe("Old"); // unchanged
  });

  it("rejects an empty name", async () => {
    const f = createFolder("Old", "you", false);
    expect((await patch(MEMBER, f.id, { name: "  " })).status).toBe(400);
  });

  it("forbids renaming another owner's folder", async () => {
    const f = createFolder("Theirs", "someone-else", false);
    expect((await patch(MEMBER, f.id, { name: "Mine now" })).status).toBe(403);
  });

  it("forbids a non-admin renaming an official folder, allows an admin", async () => {
    const f = createFolder("Official", "someone-else", true);
    expect((await patch(MEMBER, f.id, { name: "x" })).status).toBe(403);
    expect((await patch(ADMIN, f.id, { name: "Official EMT" })).status).toBe(200);
  });

  it("404s a missing folder", async () => {
    expect((await patch(MEMBER, "nope", { name: "x" })).status).toBe(404);
  });
});

describe("DELETE /api/folders/[id]", () => {
  it("deletes the owner's folder", async () => {
    const f = createFolder("Trash", "you", false);
    expect((await del(MEMBER, f.id)).status).toBe(200);
    expect(getFolder(f.id)).toBeUndefined();
  });

  it("forbids deleting another owner's folder", async () => {
    const f = createFolder("Theirs", "someone-else", false);
    expect((await del(MEMBER, f.id)).status).toBe(403);
    expect(getFolder(f.id)).toBeDefined();
  });

  it("forbids a non-admin deleting an official folder, allows an admin", async () => {
    const f = createFolder("Official", "someone-else", true);
    expect((await del(MEMBER, f.id)).status).toBe(403);
    expect((await del(ADMIN, f.id)).status).toBe(200);
  });

  it("404s a missing folder", async () => {
    expect((await del(MEMBER, "nope")).status).toBe(404);
  });
});
