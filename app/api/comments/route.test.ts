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
import { __resetComments, addComment } from "@/lib/comments";
import { __resetModules, createModule } from "@/lib/modules";
import { __resetProfile, updateProfile } from "@/lib/profile";
import { __resetRateLimit } from "@/lib/rate-limit";

const ALLOWED = { allowed: true, flagged: false, categories: [], checked: true };
const FLAGGED = { allowed: false, flagged: true, categories: ["hate"], checked: true };

const post = (body: unknown) =>
  POST(new NextRequest("https://v.test/api/comments", { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }));
const get = (type: string, target: string) =>
  GET(new NextRequest(`https://v.test/api/comments?type=${type}&target=${target}`));
const del = (id: string) =>
  DELETE(new NextRequest("https://v.test/api/comments", { method: "DELETE", body: JSON.stringify({ id }), headers: { "Content-Type": "application/json" } }));

let modId = "";
beforeEach(() => {
  process.env.VELLUM_DEMO_MODE = "1";
  __resetComments();
  __resetModules();
  __resetProfile();
  __resetRateLimit();
  moderateText.mockResolvedValue(ALLOWED);
  modId = createModule("M", "you").id;
});
afterEach(() => {
  delete process.env.VELLUM_DEMO_MODE;
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
    expect((await del(id)).status).toBe(200);
  });

  it("forbids deleting someone else's, but an admin can", async () => {
    const foreign = addComment({ targetType: "module", targetId: modId, author: "someone_else", body: "theirs" })!;
    expect((await del(foreign.id)).status).toBe(403);
    updateProfile({ role: "admin" });
    expect((await del(foreign.id)).status).toBe(200);
  });
});
