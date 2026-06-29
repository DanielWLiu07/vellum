import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";

import { GET } from "./route";
import { __resetRateLimit } from "@/lib/rate-limit";

const SECRET = "demo-route-secret-at-least-16-chars";
const req = (ip = "5.5.5.5") =>
  new NextRequest("https://vellum.test/api/demo-token", { headers: { "x-forwarded-for": ip } });

beforeEach(() => {
  __resetRateLimit();
  process.env.VELLUM_DEMO_MODE = "1";
  process.env.VELLUM_TOKEN_SECRET = SECRET;
});
afterEach(() => {
  delete process.env.VELLUM_DEMO_MODE;
  delete process.env.VELLUM_TOKEN_SECRET;
});

describe("GET /api/demo-token", () => {
  it("404s when demo mode is off", async () => {
    delete process.env.VELLUM_DEMO_MODE;
    expect((await GET(req())).status).toBe(404);
  });

  it("500s when no token secret is configured", async () => {
    delete process.env.VELLUM_TOKEN_SECRET;
    expect((await GET(req())).status).toBe(500);
  });

  it("mints a v1 token when configured", async () => {
    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.token).toBe("string");
    expect(body.token).toMatch(/^v1\./);
  });

  it("rate-limits (429 + Retry-After) after the per-IP cap", async () => {
    for (let i = 0; i < 30; i++) {
      expect((await GET(req("7.7.7.7"))).status).toBe(200);
    }
    const blocked = await GET(req("7.7.7.7"));
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("Retry-After")).toBeTruthy();
  });

  it("tracks the limit per IP (a different IP is unaffected)", async () => {
    for (let i = 0; i < 30; i++) await GET(req("8.8.8.8"));
    expect((await GET(req("8.8.8.8"))).status).toBe(429);
    expect((await GET(req("9.9.9.9"))).status).toBe(200); // separate IP, fresh budget
  });
});
