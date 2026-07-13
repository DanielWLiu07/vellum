// Image-serving route: streams stored bytes with the right content type, 404s
// an unknown id.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getImage } = vi.hoisted(() => ({ getImage: vi.fn() }));
vi.mock("@/lib/images", () => ({ getImage }));

import { GET } from "./route";

const call = (id: string) => GET(new Request(`https://v.test/api/images/${id}`), { params: Promise.resolve({ id }) });

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.clearAllMocks());

describe("GET /api/images/[id]", () => {
  it("serves the stored bytes with the content type and immutable caching", async () => {
    getImage.mockResolvedValue({ bytes: new Uint8Array([1, 2, 3]), contentType: "image/png" });
    const res = await call("img_1");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png");
    expect(res.headers.get("Cache-Control")).toContain("immutable");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("404s an unknown id", async () => {
    getImage.mockResolvedValue(undefined);
    expect((await call("img_missing")).status).toBe(404);
  });
});
