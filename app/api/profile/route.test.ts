// Profile API: GET returns the profile, PATCH updates it, moderation gates the
// free text (name + bio), and the usual guards (rate limit, disabled mode, bad
// body) hold. The moderation model itself is unit-tested in lib/moderation.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { moderateText } = vi.hoisted(() => ({ moderateText: vi.fn() }));
vi.mock("@/lib/moderation", () => ({
  moderateText,
  moderationConfigured: () => true,
  flaggedReason: (r: { categories: string[] }) => r.categories.join(", "),
}));

const { recordAudit } = vi.hoisted(() => ({ recordAudit: vi.fn() }));
vi.mock("@/lib/audit", () => ({ recordAudit }));

import { GET, PATCH } from "./route";
import { __resetProfile, getProfile } from "@/lib/profile";
import { __resetRateLimit } from "@/lib/rate-limit";

const ALLOWED = { allowed: true, flagged: false, categories: [], checked: true };
const FLAGGED = { allowed: false, flagged: true, categories: ["hate"], checked: true };

const patchReq = (body: unknown) =>
  new NextRequest("https://v.test/api/profile", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

beforeEach(() => {
  process.env.VELLUM_DEMO_MODE = "1";
  __resetProfile();
  __resetRateLimit();
  moderateText.mockResolvedValue(ALLOWED);
});
afterEach(() => {
  delete process.env.VELLUM_DEMO_MODE;
  vi.clearAllMocks();
});

describe("GET /api/profile", () => {
  it("returns the current profile", async () => {
    const res = await GET(new NextRequest("https://v.test/x"));
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.owner).toBe("you");
    expect(j.displayName).toBe("You");
  });

  it("404s when the dashboard is disabled", async () => {
    delete process.env.VELLUM_DEMO_MODE;
    expect((await GET(new NextRequest("https://v.test/x"))).status).toBe(404);
  });
});

describe("PATCH /api/profile", () => {
  it("updates fields and persists them", async () => {
    const res = await PATCH(patchReq({ displayName: "Jordan Chen", chapter: "Vancouver West", role: "advisor" }));
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.displayName).toBe("Jordan Chen");
    expect(getProfile().chapter).toBe("Vancouver West");
    expect(getProfile().role).toBe("advisor");
    expect(recordAudit).toHaveBeenCalledWith("profile.update", "Jordan Chen");
  });

  it("moderates name + bio and blocks flagged text with 422 (no write, audit recorded)", async () => {
    moderateText.mockResolvedValue(FLAGGED);
    const res = await PATCH(patchReq({ displayName: "hateful name", bio: "worse" }));
    expect(res.status).toBe(422);
    const j = await res.json();
    expect(j.error).toBe("content_flagged");
    expect(j.categories).toEqual(["hate"]);
    expect(getProfile().displayName).toBe("You"); // unchanged
    expect(recordAudit).toHaveBeenCalledWith("profile.blocked", "hateful name", "hate");
  });

  it("passes both the name and the bio to the moderator", async () => {
    await PATCH(patchReq({ displayName: "Sam", bio: "loves anatomy" }));
    const text = moderateText.mock.calls[0][0] as string;
    expect(text).toContain("Sam");
    expect(text).toContain("loves anatomy");
  });

  it("skips moderation when there is no free text (avatar-only update)", async () => {
    const res = await PATCH(patchReq({ avatarImageId: "img_123" }));
    expect(res.status).toBe(200);
    expect(moderateText).not.toHaveBeenCalled();
    expect(getProfile().avatarImageId).toBe("img_123");
  });

  it("clears the avatar when avatarImageId is null", async () => {
    await PATCH(patchReq({ avatarImageId: "img_123" }));
    await PATCH(patchReq({ avatarImageId: null }));
    expect(getProfile().avatarImageId).toBeUndefined();
  });

  it("rejects a non-object body with 400", async () => {
    expect((await PATCH(patchReq("not json"))).status).toBe(400);
  });

  it("rate-limits after the per-window cap", async () => {
    let last = 200;
    for (let i = 0; i < 25; i++) last = (await PATCH(patchReq({ displayName: `n${i}` }))).status;
    expect(last).toBe(429);
  });

  it("404s when the dashboard is disabled", async () => {
    delete process.env.VELLUM_DEMO_MODE;
    expect((await PATCH(patchReq({ displayName: "x" }))).status).toBe(404);
  });
});
