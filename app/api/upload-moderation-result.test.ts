// What the upload route TELLS the uploader about moderation.
//
// The decision logic is unit-tested in lib/moderation-gate; this covers the
// reporting, which had two holes. A quarantined upload returned a bare success
// the form rendered as clean, so an owner never learned their file was held or
// why sharing then refused. And a refusal never said WHICH check refused, so
// the form always blamed the title — advice that cannot work when the picture
// inside the file was the problem.

import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const CLEAN = { allowed: true, flagged: false, categories: [], checked: true };
const mod = vi.hoisted(() => ({
  moderateText: vi.fn(),
  moderateImage: vi.fn(),
  configured: { value: true },
}));

vi.mock("@/lib/moderation", () => ({
  moderateText: mod.moderateText,
  moderateImage: mod.moderateImage,
  moderationConfigured: () => mod.configured.value,
  flaggedReason: (r: { categories: string[] }) => r.categories.join(", "),
}));
vi.mock("@/lib/copyright", () => ({ scanCopyright: () => ({ flagged: false, signals: [] }) }));

import { __resetRateLimit } from "@/lib/rate-limit";

import { POST } from "./upload/route";

/** "sexual/minors" is the one HARD_REFUSE category — everything else is held. */
const refused = (categories: string[]) => ({ allowed: false, flagged: true, categories, checked: true });
const flagged = (categories: string[]) => ({ allowed: false, flagged: true, categories, checked: true });
/** Configured but never examined — a size cap or a render failure. */
const unchecked = { allowed: true, flagged: false, categories: [], checked: false };

function upload(name = "Study notes") {
  const fd = new FormData();
  fd.set("file", new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4])], "x.png", { type: "image/png" }));
  fd.set("name", name);
  return new NextRequest("https://v.test/api/upload", { method: "POST", body: fd });
}

beforeEach(() => {
  process.env.VELLUM_DEMO_MODE = "1";
  __resetRateLimit();
  mod.configured.value = true;
  mod.moderateText.mockResolvedValue(CLEAN);
  mod.moderateImage.mockResolvedValue(CLEAN);
});
afterEach(() => {
  delete process.env.VELLUM_DEMO_MODE;
  vi.clearAllMocks();
});

describe("refusal names which check refused", () => {
  it("reports source 'title' when the name was refused", async () => {
    mod.moderateText.mockResolvedValue(refused(["sexual/minors"]));
    const res = await POST(upload("a refused title"));
    expect(res.status).toBe(422);
    const j = await res.json();
    expect(j).toMatchObject({ error: "content_flagged", source: "title" });
    expect(j.categories).toEqual(["sexual/minors"]);
  });

  // The case the old copy got wrong: a clean title, refused picture. Telling
  // this uploader to rename the file would send them in a circle.
  it("reports source 'content' when the file body was refused", async () => {
    mod.moderateImage.mockResolvedValue(refused(["sexual/minors"]));
    const res = await POST(upload("Perfectly ordinary title"));
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ error: "content_flagged", source: "content" });
  });

  it("attributes to the title when BOTH refused, since renaming is actionable", async () => {
    mod.moderateText.mockResolvedValue(refused(["sexual/minors"]));
    mod.moderateImage.mockResolvedValue(refused(["sexual/minors"]));
    expect(await (await POST(upload())).json()).toMatchObject({ source: "title" });
  });
});

describe("a held upload says so, and says why", () => {
  it("reports the hold with reason 'flagged' and the categories", async () => {
    mod.moderateImage.mockResolvedValue(flagged(["violence"]));
    const res = await POST(upload());
    expect(res.status).toBe(200); // stored — a hold is not a refusal
    const j = await res.json();
    expect(j).toMatchObject({ heldForReview: true, holdReason: "flagged" });
    expect(j.categories).toEqual(["violence"]);
    expect(j.id).toBeTruthy();
  });

  // "Nobody looked at this" must not read as "we found something" — the copy
  // branches on this, so the reason has to survive the round trip.
  it("reports reason 'unchecked' when moderation could not examine it", async () => {
    mod.moderateImage.mockResolvedValue(unchecked);
    const j = await (await POST(upload())).json();
    expect(j).toMatchObject({ heldForReview: true, holdReason: "unchecked" });
    expect(j.categories).toEqual([]);
  });

  it("holds on a flagged title too, not just a flagged body", async () => {
    mod.moderateText.mockResolvedValue(flagged(["harassment"]));
    expect(await (await POST(upload())).json()).toMatchObject({
      heldForReview: true,
      holdReason: "flagged",
    });
  });
});

describe("a clean upload claims no hold", () => {
  it("omits heldForReview entirely", async () => {
    const j = await (await POST(upload())).json();
    expect(j.heldForReview).toBeUndefined();
    expect(j.holdReason).toBeUndefined();
    expect(j.id).toBeTruthy();
  });

  // With no API key the feature is off by design, so an unexamined file is not
  // a hold — otherwise every local upload would queue for review.
  it("omits it when moderation is unconfigured, even unexamined", async () => {
    mod.configured.value = false;
    mod.moderateImage.mockResolvedValue(unchecked);
    const j = await (await POST(upload())).json();
    expect(j.heldForReview).toBeUndefined();
  });
});
