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
import { SESSION_COOKIE } from "@/lib/auth";
import { mintIdentityToken } from "@/lib/identity-token";
import { __resetProfile, getProfile, getViewer } from "@/lib/profile";
import { __resetRateLimit } from "@/lib/rate-limit";

const ALLOWED = { allowed: true, flagged: false, categories: [], checked: true };
const FLAGGED = { allowed: false, flagged: true, categories: ["hate"], checked: true };
// What moderateText returns when it never ran: allowed, but examined by nobody.
const SKIPPED = { allowed: true, flagged: false, categories: [], checked: false };

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
    // Only the member's own fields: chapter is rejected outright and role is
    // dropped, both covered by their own describes below.
    const res = await PATCH(patchReq({ displayName: "Jordan Chen", bio: "loves EMT" }));
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.displayName).toBe("Jordan Chen");
    expect(getProfile().displayName).toBe("Jordan Chen");
    expect(getProfile().bio).toBe("loves EMT");
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

  // A bio is shown beside this member's name wherever they appear, and the old
  // check read a never-ran result as a pass — so during an outage a bio went
  // live having been examined by nobody. Refusing leaves the previous values
  // standing, which costs the member nothing they had.
  it("refuses an edit nobody could check, leaving the profile as it was", async () => {
    moderateText.mockResolvedValue(SKIPPED);
    const res = await PATCH(patchReq({ displayName: "Unchecked", bio: "unchecked" }));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("moderation_unavailable");
    expect(getProfile().displayName).toBe("You");
    // Recorded as a block so an admin can see why edits started failing, with
    // the cause in the detail rather than a category nobody tripped.
    expect(recordAudit).toHaveBeenCalledWith(
      "profile.blocked",
      "Unchecked",
      "not checked - moderation unavailable",
    );
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

describe("PATCH /api/profile - chapter is not the member's to set", () => {
  it("rejects a body carrying a chapter instead of silently dropping it", async () => {
    const res = await PATCH(patchReq({ displayName: "Jordan", chapter: "Vancouver West" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("chapter_not_editable");
    // The whole patch is refused, so the name didn't land either.
    expect(getProfile().chapter).toBe("Toronto Central");
    expect(getProfile().displayName).toBe("You");
  });

  it("rejects an empty-string chapter too (the sneaky 'clear it' case)", async () => {
    expect((await PATCH(patchReq({ chapter: "" }))).status).toBe(400);
  });

  it("still saves a patch that minds its own business", async () => {
    expect((await PATCH(patchReq({ displayName: "Jordan" }))).status).toBe(200);
    expect(getProfile().displayName).toBe("Jordan");
  });
});

describe("PATCH /api/profile - role is not the member's to set", () => {
  it("drops a role from the patch instead of granting it", async () => {
    // Dropped rather than rejected (the route stays compatible with clients
    // that echo the whole profile back), but it must not land: with no session
    // getViewer() derives `admin` from this profile, so honouring a role patch
    // would let any signed-out visitor make themselves an admin.
    const res = await PATCH(patchReq({ displayName: "Jordan", role: "admin" }));
    expect(res.status).toBe(200);
    expect((await res.json()).role).toBe("student");
    expect(getProfile().role).toBe("student");
    expect(getViewer().admin).toBe(false);
    // The rest of the patch still applies.
    expect(getProfile().displayName).toBe("Jordan");
  });

  it("ignores a role sent on its own too", async () => {
    expect((await PATCH(patchReq({ role: "admin" }))).status).toBe(200);
    expect(getViewer().admin).toBe(false);
  });
});

// Signed-session cases run LAST: a session can be entered but never cleared,
// so it would leak into the sessionless tests above.
describe("PATCH /api/profile - a signed-in member's chapter tracks their token", () => {
  const SECRET = "shared-secret-at-least-16-chars";
  const signed = (body: unknown) =>
    new NextRequest("https://v.test/api/profile", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Cookie: `${SESSION_COOKIE}=${mintIdentityToken(SECRET, { sub: "hosa_7", name: "Ada", chapter: "Vancouver West", role: "student" })}`,
      },
      body: JSON.stringify(body),
    });

  beforeEach(() => { process.env.VITALS_AUTH_SECRET = SECRET; });
  afterEach(() => { delete process.env.VITALS_AUTH_SECRET; });

  it("returns the chapter from the token, not from the request", async () => {
    const res = await PATCH(signed({ displayName: "Ada" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ owner: "hosa_7", chapter: "Vancouver West" });
  });

  it("400s a signed member who tries to move themselves", async () => {
    const res = await PATCH(signed({ chapter: "Toronto Central" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("chapter_not_editable");
  });
});
