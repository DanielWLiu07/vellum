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
import { __resetFolders, createFolder, getFolder } from "@/lib/folders";
import { __resetProfile, updateProfile } from "@/lib/profile";

const ALLOWED = { allowed: true, flagged: false, categories: [], checked: true };
const FLAGGED = { allowed: false, flagged: true, categories: ["hate"], checked: true };

const patch = (id: string, body: unknown) =>
  PATCH(
    new NextRequest(`https://v.test/api/folders/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    }),
    { params: Promise.resolve({ id }) },
  );
const del = (id: string) =>
  DELETE(new NextRequest(`https://v.test/api/folders/${id}`, { method: "DELETE" }), { params: Promise.resolve({ id }) });

beforeEach(() => {
  process.env.VELLUM_DEMO_MODE = "1";
  __resetFolders();
  __resetProfile();
  moderateText.mockResolvedValue(ALLOWED);
});
afterEach(() => {
  delete process.env.VELLUM_DEMO_MODE;
  vi.clearAllMocks();
});

describe("PATCH /api/folders/[id]", () => {
  it("renames the owner's folder", async () => {
    const f = createFolder("Old", "you", false);
    const res = await patch(f.id, { name: "New" });
    expect(res.status).toBe(200);
    expect((await res.json()).folder.name).toBe("New");
    expect(getFolder(f.id)!.name).toBe("New");
  });

  it("moderates the new name", async () => {
    const f = createFolder("Old", "you", false);
    moderateText.mockResolvedValue(FLAGGED);
    const res = await patch(f.id, { name: "hateful" });
    expect(res.status).toBe(422);
    expect(getFolder(f.id)!.name).toBe("Old"); // unchanged
  });

  it("rejects an empty name", async () => {
    const f = createFolder("Old", "you", false);
    expect((await patch(f.id, { name: "  " })).status).toBe(400);
  });

  it("forbids renaming another owner's folder", async () => {
    const f = createFolder("Theirs", "someone-else", false);
    expect((await patch(f.id, { name: "Mine now" })).status).toBe(403);
  });

  it("forbids a non-admin renaming an official folder, allows an admin", async () => {
    const f = createFolder("Official", "someone-else", true);
    expect((await patch(f.id, { name: "x" })).status).toBe(403);
    updateProfile({ role: "admin" });
    expect((await patch(f.id, { name: "Official EMT" })).status).toBe(200);
  });

  it("404s a missing folder", async () => {
    expect((await patch("nope", { name: "x" })).status).toBe(404);
  });
});

describe("DELETE /api/folders/[id]", () => {
  it("deletes the owner's folder", async () => {
    const f = createFolder("Trash", "you", false);
    expect((await del(f.id)).status).toBe(200);
    expect(getFolder(f.id)).toBeUndefined();
  });

  it("forbids deleting another owner's folder", async () => {
    const f = createFolder("Theirs", "someone-else", false);
    expect((await del(f.id)).status).toBe(403);
    expect(getFolder(f.id)).toBeDefined();
  });

  it("forbids a non-admin deleting an official folder, allows an admin", async () => {
    const f = createFolder("Official", "someone-else", true);
    expect((await del(f.id)).status).toBe(403);
    updateProfile({ role: "admin" });
    expect((await del(f.id)).status).toBe(200);
  });

  it("404s a missing folder", async () => {
    expect((await del("nope")).status).toBe(404);
  });
});
