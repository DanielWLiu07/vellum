// Comments API: post (moderated, gated to a viewable target), list, and
// author/admin-only delete. Tested against module targets to avoid the upload
// store; the gating path is shared with docs.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { moderateText } = vi.hoisted(() => ({ moderateText: vi.fn() }));
vi.mock("@/lib/moderation", () => ({
  moderateText,
  moderationConfigured: () => true,
  flaggedReason: (r: { categories: string[] }) => r.categories.join(", "),
}));
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn() }));

import { DELETE, GET, POST } from "./route";
import { SESSION_COOKIE } from "@/lib/auth";
import { __resetComments, addComment } from "@/lib/comments";
import { mintIdentityToken } from "@/lib/identity-token";
import { __resetModules, createModule } from "@/lib/modules";
import { __resetProfile } from "@/lib/profile";
import { __resetRateLimit } from "@/lib/rate-limit";

const ALLOWED = { allowed: true, flagged: false, categories: [], checked: true };
const FLAGGED = { allowed: false, flagged: true, categories: ["hate"], checked: true };
// What moderateText returns when it never ran: allowed, but examined by nobody.
const SKIPPED = { allowed: true, flagged: false, categories: [], checked: false };

// Admin comes from the signed session, never from the local profile (role isn't
// patchable — that was a self-escalation path). MEMBER keeps the "you" owner key
// the standalone demo profile uses, so a comment they post is authored by "you".
const SECRET = "shared-secret-at-least-16-chars";
const MEMBER = { sub: "you", name: "You", chapter: "Toronto Central", role: "student" } as const;
const ADMIN = { sub: "admin_1", name: "Daniel Liu", chapter: "HOSA Canada", role: "admin" } as const;
type Person = typeof MEMBER | typeof ADMIN;
const cookie = (p: Person) => `${SESSION_COOKIE}=${mintIdentityToken(SECRET, { ...p })}`;

const post = (body: unknown) =>
  POST(new NextRequest("https://v.test/api/comments", { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json", Cookie: cookie(MEMBER) } }));
const get = (type: string, target: string) =>
  GET(new NextRequest(`https://v.test/api/comments?type=${type}&target=${target}`, { headers: { Cookie: cookie(MEMBER) } }));
const del = (who: Person, id: string) =>
  DELETE(new NextRequest("https://v.test/api/comments", { method: "DELETE", body: JSON.stringify({ id }), headers: { "Content-Type": "application/json", Cookie: cookie(who) } }));

let modId = "";
beforeEach(() => {
  process.env.VELLUM_DEMO_MODE = "1";
  process.env.VITALS_AUTH_SECRET = SECRET;
  __resetComments();
  __resetModules();
  __resetProfile();
  __resetRateLimit();
  moderateText.mockResolvedValue(ALLOWED);
  modId = createModule("M", "you").id;
});
afterEach(() => {
  delete process.env.VELLUM_DEMO_MODE;
  delete process.env.VITALS_AUTH_SECRET;
  vi.clearAllMocks();
});

describe("POST /api/comments", () => {
  it("posts a comment on an existing module", async () => {
    const res = await post({ type: "module", target: modId, body: "Great module!" });
    expect(res.status).toBe(200);
    expect((await res.json()).comment.body).toBe("Great module!");
  });

  it("404s a target that doesn't exist", async () => {
    expect((await post({ type: "module", target: "m_missing", body: "hi" })).status).toBe(404);
  });

  it("blocks a flagged comment (422)", async () => {
    moderateText.mockResolvedValue(FLAGGED);
    expect((await post({ type: "module", target: modId, body: "nasty" })).status).toBe(422);
  });

  // A comment is read by everyone who can see the thread the moment it lands,
  // and there is nowhere to hold one pending review, so an unexamined comment
  // must not be posted. The old check let it through: a skipped moderation call
  // reports allowed:true, and the account is 429ing every call today.
  it("refuses a comment nobody could check (503) and posts nothing", async () => {
    moderateText.mockResolvedValue(SKIPPED);
    const res = await post({ type: "module", target: modId, body: "unchecked" });
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("moderation_unavailable");
    // Says when to come back, and does not accuse the author of anything.
    expect(res.headers.get("Retry-After")).toBe("60");
    expect((await (await get("module", modId)).json()).comments).toEqual([]);
  });

  it("400s an empty body or bad target type", async () => {
    expect((await post({ type: "module", target: modId, body: "   " })).status).toBe(400);
    expect((await post({ type: "bogus", target: modId, body: "hi" })).status).toBe(400);
  });
});

describe("GET /api/comments", () => {
  it("lists a target's comments oldest-first", async () => {
    await post({ type: "module", target: modId, body: "first" });
    await post({ type: "module", target: modId, body: "second" });
    const j = await (await get("module", modId)).json();
    expect(j.comments.map((c: { body: string }) => c.body)).toEqual(["first", "second"]);
  });
});

describe("DELETE /api/comments", () => {
  it("lets the author delete their own", async () => {
    const id = (await (await post({ type: "module", target: modId, body: "mine" })).json()).comment.id;
    expect((await del(MEMBER, id)).status).toBe(200);
  });

  it("forbids deleting someone else's, but an admin can", async () => {
    const foreign = addComment({ targetType: "module", targetId: modId, author: "someone_else", body: "theirs" })!;
    expect((await del(MEMBER, foreign.id)).status).toBe(403);
    expect((await del(ADMIN, foreign.id)).status).toBe(200);
  });
});
