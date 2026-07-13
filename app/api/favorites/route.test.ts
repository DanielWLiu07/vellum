// Favorites API: the current viewer can list, save, unsave, and toggle a
// resource. Guards (rate limit, disabled mode, bad body) hold.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { GET, POST } from "./route";
import { __resetFavorites } from "@/lib/favorites";
import { __resetProfile } from "@/lib/profile";
import { __resetRateLimit } from "@/lib/rate-limit";

const postReq = (body: unknown) =>
  new NextRequest("https://v.test/api/favorites", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

beforeEach(() => {
  process.env.VELLUM_DEMO_MODE = "1";
  __resetFavorites();
  __resetProfile();
  __resetRateLimit();
});
afterEach(() => {
  delete process.env.VELLUM_DEMO_MODE;
  vi.clearAllMocks();
});

describe("GET /api/favorites", () => {
  it("starts empty", async () => {
    const res = await GET(new NextRequest("https://v.test/x"));
    expect(res.status).toBe(200);
    expect((await res.json()).ids).toEqual([]);
  });

  it("404s when the dashboard is disabled", async () => {
    delete process.env.VELLUM_DEMO_MODE;
    expect((await GET(new NextRequest("https://v.test/x"))).status).toBe(404);
  });
});

describe("POST /api/favorites", () => {
  it("saves a resource and reports the count", async () => {
    const res = await POST(postReq({ id: "u_1", favorite: true }));
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j).toMatchObject({ id: "u_1", favorite: true, count: 1 });
    const list = await (await GET(new NextRequest("https://v.test/x"))).json();
    expect(list.ids).toEqual(["u_1"]);
    expect(list.counts).toEqual({ u_1: 1 }); // global like-count exposed to the client
  });

  it("unsaves when favorite is false", async () => {
    await POST(postReq({ id: "u_1", favorite: true }));
    const res = await POST(postReq({ id: "u_1", favorite: false }));
    expect((await res.json())).toMatchObject({ favorite: false, count: 0 });
    expect((await (await GET(new NextRequest("https://v.test/x"))).json()).ids).toEqual([]);
  });

  it("toggles when favorite is omitted", async () => {
    expect((await (await POST(postReq({ id: "u_1" }))).json()).favorite).toBe(true);
    expect((await (await POST(postReq({ id: "u_1" }))).json()).favorite).toBe(false);
  });

  it("rejects a body with no id (400)", async () => {
    expect((await POST(postReq({ favorite: true }))).status).toBe(400);
    expect((await POST(postReq("not json"))).status).toBe(400);
  });

  it("rate-limits after the per-window cap", async () => {
    let last = 200;
    for (let i = 0; i < 65; i++) last = (await POST(postReq({ id: `u_${i}` }))).status;
    expect(last).toBe(429);
  });

  it("404s when the dashboard is disabled", async () => {
    delete process.env.VELLUM_DEMO_MODE;
    expect((await POST(postReq({ id: "u_1" }))).status).toBe(404);
  });
});
