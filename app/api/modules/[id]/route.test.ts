// Module [id] API: anyone reads the full module; edit/delete are admin-only and
// the seeded sample is immutable.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { moderateText } = vi.hoisted(() => ({ moderateText: vi.fn() }));
vi.mock("@/lib/moderation", () => ({
  moderateText,
  moderationConfigured: () => true,
  flaggedReason: (r: { categories: string[] }) => r.categories.join(", "),
}));
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn() }));

import { DELETE, GET, PATCH } from "./route";
import { SESSION_COOKIE } from "@/lib/auth";
import { mintIdentityToken } from "@/lib/identity-token";
import { __resetModules, createModule } from "@/lib/modules";
import { __resetProfile } from "@/lib/profile";

const ALLOWED = { allowed: true, flagged: false, categories: [], checked: true };

// Admin comes from the signed session, never from the local profile (role isn't
// patchable — that was a self-escalation path). MEMBER keeps the "you" owner key
// the standalone demo profile uses, so seeded fixtures stay the member's own.
const SECRET = "shared-secret-at-least-16-chars";
const MEMBER = { sub: "you", name: "You", chapter: "Toronto Central", role: "student" } as const;
const ADMIN = { sub: "admin_1", name: "Daniel Liu", chapter: "HOSA Canada", role: "admin" } as const;
type Person = typeof MEMBER | typeof ADMIN;
const cookie = (p: Person) => `${SESSION_COOKIE}=${mintIdentityToken(SECRET, { ...p })}`;

const get = (who: Person, id: string) =>
  GET(new NextRequest(`https://v.test/api/modules/${id}`, { headers: { Cookie: cookie(who) } }), { params: Promise.resolve({ id }) });
const patch = (who: Person, id: string, body: unknown) =>
  PATCH(new NextRequest(`https://v.test/api/modules/${id}`, { method: "PATCH", body: JSON.stringify(body), headers: { "Content-Type": "application/json", Cookie: cookie(who) } }), { params: Promise.resolve({ id }) });
const del = (who: Person, id: string) =>
  DELETE(new NextRequest(`https://v.test/api/modules/${id}`, { method: "DELETE", headers: { Cookie: cookie(who) } }), { params: Promise.resolve({ id }) });

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

describe("GET /api/modules/[id]", () => {
  it("returns the full module for any member; canEdit false for non-admin", async () => {
    const m = createModule("Airway", "you", {
      sections: [{ title: "a", subsections: [{ title: "p", slides: "1AbcDEF_ghIJKlmnop123456789" }] }],
    });
    const res = await get(MEMBER, m.id);
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.module.sections[0].subsections[0].slidesId).toBe("1AbcDEF_ghIJKlmnop123456789");
    expect(j.canEdit).toBe(false);
  });

  it("404s a missing module", async () => {
    expect((await get(MEMBER, "nope")).status).toBe(404);
  });
});

describe("PATCH /api/modules/[id] (admin only)", () => {
  it("403s a non-admin", async () => {
    const m = createModule("A", "you");
    expect((await patch(MEMBER, m.id, { title: "B" })).status).toBe(403);
  });

  it("saves sections + slides for an admin", async () => {
    const m = createModule("A", "someone");
    const res = await patch(ADMIN, m.id, { title: "A2", sections: [{ title: "Sec", subsections: [{ title: "P", slides: "1AbcDEF_ghIJKlmnop123456789" }] }] });
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.module.title).toBe("A2");
    expect(j.module.sections[0].subsections[0].title).toBe("P");
    expect(j.module.sections[0].subsections[0].slidesId).toBe("1AbcDEF_ghIJKlmnop123456789");
  });
});

describe("DELETE /api/modules/[id] (admin only)", () => {
  it("403s a non-admin, deletes for an admin, and refuses the sample", async () => {
    const m = createModule("Temp", "you");
    expect((await del(MEMBER, m.id)).status).toBe(403);
    expect((await del(ADMIN, m.id)).status).toBe(200);
    expect((await del(ADMIN, "sample-module")).status).toBe(404); // guarded, returns not-found
  });
});
