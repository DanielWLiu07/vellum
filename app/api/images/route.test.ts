// Image upload API: sniffs the type, MODERATES the image before storing, and
// enforces the size / demo / rate-limit guards. This is the route-level proof
// that moderation is actually wired into the upload path (the lib is unit-tested
// separately in lib/moderation.test.ts).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { moderateImage } = vi.hoisted(() => ({ moderateImage: vi.fn() }));
vi.mock("@/lib/moderation", () => ({
  moderateImage,
  moderationConfigured: () => true,
  flaggedReason: (r: { categories: string[] }) => r.categories.join(", "),
}));
const { recordAudit } = vi.hoisted(() => ({ recordAudit: vi.fn() }));
vi.mock("@/lib/audit", () => ({ recordAudit }));
const { putImage } = vi.hoisted(() => ({ putImage: vi.fn() }));
vi.mock("@/lib/images", () => ({ putImage }));

import { POST } from "./route";
import { __resetRateLimit } from "@/lib/rate-limit";

const ALLOWED = { allowed: true, flagged: false, categories: [], checked: true };
const FLAGGED = { allowed: false, flagged: true, categories: ["violence"], checked: true };

// A minimal buffer whose magic bytes sniff as PNG (0x89 P N G ...).
const png = () => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

function postFile(bytes: Uint8Array, type = "image/png"): NextRequest {
  const fd = new FormData();
  fd.set("file", new File([bytes], "card.png", { type }));
  return new NextRequest("https://v.test/api/images", { method: "POST", body: fd });
}

beforeEach(() => {
  process.env.VELLUM_DEMO_MODE = "1";
  __resetRateLimit();
  putImage.mockResolvedValue("img_test");
  moderateImage.mockResolvedValue(ALLOWED);
});
afterEach(() => {
  delete process.env.VELLUM_DEMO_MODE;
  vi.clearAllMocks();
});

describe("POST /api/images", () => {
  it("moderates then stores a clean image", async () => {
    const res = await POST(postFile(png()));
    expect(res.status).toBe(200);
    expect((await res.json()).id).toBe("img_test");
    expect(moderateImage).toHaveBeenCalledOnce();
    expect(putImage).toHaveBeenCalledOnce();
  });

  it("blocks a flagged image: 422, audits it, and does NOT store it", async () => {
    moderateImage.mockResolvedValue(FLAGGED);
    const res = await POST(postFile(png()));
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe("content_flagged");
    expect(recordAudit).toHaveBeenCalledWith("image.blocked", "card image", "violence");
    expect(putImage).not.toHaveBeenCalled(); // the bytes never reach storage
  });

  it("moderates BEFORE storing (order matters)", async () => {
    // If moderation ran after the put, a flagged image would already be stored.
    moderateImage.mockResolvedValue(FLAGGED);
    await POST(postFile(png()));
    expect(putImage).not.toHaveBeenCalled();
  });

  it("rejects a non-image by magic bytes (415) without moderating", async () => {
    const res = await POST(postFile(new Uint8Array([1, 2, 3, 4, 5])));
    expect(res.status).toBe(415);
    expect((await res.json()).error).toBe("not_image");
    expect(moderateImage).not.toHaveBeenCalled();
    expect(putImage).not.toHaveBeenCalled();
  });

  it("rejects an oversized image (413) before reading it", async () => {
    const big = new Uint8Array(5 * 1024 * 1024 + 1);
    big.set(png());
    const res = await POST(postFile(big));
    expect(res.status).toBe(413);
    expect(moderateImage).not.toHaveBeenCalled();
  });

  it("400s when no file is attached", async () => {
    const res = await POST(new NextRequest("https://v.test/api/images", { method: "POST", body: new FormData() }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("no_file");
  });

  it("rate-limits after the per-minute cap (429)", async () => {
    let last = 200;
    for (let i = 0; i < 31; i++) last = (await POST(postFile(png()))).status;
    expect(last).toBe(429);
  });

  it("404s when the dashboard is disabled", async () => {
    delete process.env.VELLUM_DEMO_MODE;
    expect((await POST(postFile(png()))).status).toBe(404);
  });
});
