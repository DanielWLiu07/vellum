import { beforeEach, describe, expect, it } from "vitest";

import { __resetRateLimit, clientIp, rateLimit } from "./rate-limit";

beforeEach(() => __resetRateLimit());

describe("rateLimit", () => {
  it("allows up to the limit, then blocks within the window", () => {
    const key = "share:1.2.3.4";
    expect(rateLimit(key, 3, 60_000, 0).ok).toBe(true);
    expect(rateLimit(key, 3, 60_000, 0).ok).toBe(true);
    const third = rateLimit(key, 3, 60_000, 0);
    expect(third.ok).toBe(true);
    expect(third.remaining).toBe(0);
    const blocked = rateLimit(key, 3, 60_000, 0);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfter).toBeGreaterThan(0);
  });

  it("resets after the window elapses", () => {
    const key = "demo:9.9.9.9";
    rateLimit(key, 1, 1_000, 0);
    expect(rateLimit(key, 1, 1_000, 500).ok).toBe(false); // still in window
    expect(rateLimit(key, 1, 1_000, 1_000).ok).toBe(true); // window rolled over
  });

  it("tracks keys independently", () => {
    expect(rateLimit("a", 1, 60_000, 0).ok).toBe(true);
    expect(rateLimit("a", 1, 60_000, 0).ok).toBe(false);
    expect(rateLimit("b", 1, 60_000, 0).ok).toBe(true); // different key unaffected
  });
});

describe("clientIp", () => {
  it("takes the first x-forwarded-for entry", () => {
    const req = new Request("https://x.test", { headers: { "x-forwarded-for": "203.0.113.1, 10.0.0.1" } });
    expect(clientIp(req)).toBe("203.0.113.1");
  });

  it("falls back to x-real-ip, then 'unknown'", () => {
    expect(clientIp(new Request("https://x.test", { headers: { "x-real-ip": "198.51.100.2" } }))).toBe("198.51.100.2");
    expect(clientIp(new Request("https://x.test"))).toBe("unknown");
  });
});
