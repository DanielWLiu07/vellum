// Authorization on doc PATCH: filing (folderId) and the official flag. A member
// must NOT be able to file a doc into an official / someone-else's folder, and
// only an admin may mark a doc official.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/moderation", () => {
  const CLEAN = { allowed: true, flagged: false, categories: [], checked: true };
  return {
    moderateText: vi.fn().mockResolvedValue(CLEAN),
    moderateImage: vi.fn().mockResolvedValue(CLEAN),
    moderationConfigured: () => false,
    flaggedReason: (r: { categories: string[] }) => r.categories.join(", "),
  };
});

import { PATCH } from "./doc/[id]/route";
import { addUpload, deleteDoc } from "@/lib/store";
import { SESSION_COOKIE } from "@/lib/auth";
import { createFolder, __resetFolders } from "@/lib/folders";
import { mintIdentityToken } from "@/lib/identity-token";
import { getResourceMeta, __resetResourceMeta } from "@/lib/resource-meta";
import { __resetProfile } from "@/lib/profile";
import { __resetRateLimit } from "@/lib/rate-limit";

// Admin comes from the signed session, never from the local profile (role isn't
// patchable — that was a self-escalation path). MEMBER keeps the "you" owner key
// the doc below is seeded with, so "the owner" really is the caller.
const SECRET = "shared-secret-at-least-16-chars";
const MEMBER = { sub: "you", name: "You", chapter: "Toronto Central", role: "student" } as const;
const ADMIN = { sub: "admin_1", name: "Daniel Liu", chapter: "HOSA Canada", role: "admin" } as const;
type Person = typeof MEMBER | typeof ADMIN;
const cookie = (p: Person) => `${SESSION_COOKIE}=${mintIdentityToken(SECRET, { ...p })}`;

const patchReq = (who: Person, id: string, body: unknown) =>
  PATCH(
    new NextRequest(`https://v.test/api/doc/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: cookie(who) },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );

let docId = "";
beforeEach(async () => {
  process.env.VELLUM_DEMO_MODE = "1";
  process.env.VITALS_AUTH_SECRET = SECRET;
  __resetFolders();
  __resetResourceMeta();
  __resetProfile();
  __resetRateLimit();
  // A doc owned by the member making these requests ("you").
  const meta = await addUpload("Mine", new Uint8Array([1, 2, 3]), "application/pdf", { visibility: "public", chapter: "", owner: "you" });
  docId = meta.id;
});
afterEach(async () => {
  await deleteDoc(docId);
  delete process.env.VELLUM_DEMO_MODE;
  delete process.env.VITALS_AUTH_SECRET;
  vi.clearAllMocks();
});

describe("doc PATCH filing + official authorization", () => {
  it("lets the owner file their doc into their OWN folder", async () => {
    const mine = createFolder("My set", "you", false);
    const res = await patchReq(MEMBER, docId, { folderId: mine.id });
    expect(res.status).toBe(200);
    expect(getResourceMeta(docId)?.folderId).toBe(mine.id);
  });

  it("BLOCKS filing a doc into an OFFICIAL folder as a non-admin", async () => {
    const official = createFolder("Official", "HOSA Canada", true, "f_official");
    const res = await patchReq(MEMBER, docId, { folderId: official.id });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("invalid_folder");
    expect(getResourceMeta(docId)?.folderId).toBeUndefined(); // not filed
  });

  it("BLOCKS filing into someone else's personal folder", async () => {
    const ninas = createFolder("Nina's", "nina", false);
    expect((await patchReq(MEMBER, docId, { folderId: ninas.id })).status).toBe(403);
  });

  it("BLOCKS a non-admin marking a doc official", async () => {
    const res = await patchReq(MEMBER, docId, { official: true });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("admin_only");
  });

  it("lets an admin file into an official folder and mark official", async () => {
    const official = createFolder("Official", "HOSA Canada", true, "f_official2");
    expect((await patchReq(ADMIN, docId, { folderId: official.id })).status).toBe(200);
    expect((await patchReq(ADMIN, docId, { official: true })).status).toBe(200);
    expect(getResourceMeta(docId)?.official).toBe(true);
  });
});
