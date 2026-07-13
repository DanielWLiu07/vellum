// Copyright screen on upload: material that trips the copyright detector is
// rejected with 451 and never stored. The detector's own logic is unit-tested
// in lib/copyright; here we only prove the route honors its verdict.

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
const copyright = vi.hoisted(() => ({ scanCopyright: vi.fn() }));
vi.mock("@/lib/copyright", () => copyright);

import { POST } from "./upload/route";
import { __resetRateLimit } from "@/lib/rate-limit";

function pngUpload(name: string) {
  const fd = new FormData();
  fd.set("file", new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4])], "x.png", { type: "image/png" }));
  fd.set("name", name);
  return new NextRequest("https://v.test/api/upload", { method: "POST", body: fd });
}

beforeEach(() => {
  process.env.VELLUM_DEMO_MODE = "1";
  __resetRateLimit();
  copyright.scanCopyright.mockReturnValue({ flagged: false, signals: [] });
});
afterEach(() => {
  delete process.env.VELLUM_DEMO_MODE;
  vi.clearAllMocks();
});

describe("upload copyright screen", () => {
  it("blocks a copyright-flagged upload with 451 and its signals", async () => {
    copyright.scanCopyright.mockReturnValue({ flagged: true, signals: ["ISBN", "pearson"] });
    const res = await POST(pngUpload("Anatomy textbook scan"));
    expect(res.status).toBe(451);
    const j = await res.json();
    expect(j.error).toBe("copyright_flagged");
    expect(j.signals).toEqual(["ISBN", "pearson"]);
  });

  it("scans the display name for markers", async () => {
    await POST(pngUpload("Pearson chapter 4"));
    expect(copyright.scanCopyright).toHaveBeenCalled();
    expect(copyright.scanCopyright.mock.calls[0][0]).toContain("Pearson chapter 4");
  });

  it("allows a clean upload (200)", async () => {
    const res = await POST(pngUpload("My own study notes"));
    expect(res.status).toBe(200);
  });
});
