import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { mintIdentityToken, SESSION_COOKIE } from "@/lib/identity-token";

import { proxy } from "./proxy";

const SECRET = "test-secret-at-least-16-chars";
const ORIGIN = "https://vitals.hosacanada.org";

function request(path: string, cookie?: string): NextRequest {
  return new NextRequest(new URL(path, ORIGIN), {
    headers: cookie ? { cookie: `${SESSION_COOKIE}=${cookie}` } : {},
  });
}

const validToken = () =>
  mintIdentityToken(SECRET, { sub: "hosa_1", name: "Nina", chapter: "chp_1", role: "student" });

/** NextResponse.next() carries this header; a blocked response does not. */
const passedThrough = (res: { headers: Headers; status: number }) =>
  res.status === 200 && res.headers.has("x-middleware-next");

describe("proxy — attached to HOSA (secret configured)", () => {
  beforeEach(() => vi.stubEnv("VITALS_AUTH_SECRET", SECRET));
  afterEach(() => vi.unstubAllEnvs());

  it("lets an authenticated member through", () => {
    expect(passedThrough(proxy(request("/dashboard", validToken())))).toBe(true);
  });

  // The hole this file closes: with no gate, an anonymous visitor reached the
  // dashboard and getViewer() handed them a real chapter.
  it("redirects an anonymous page request to the signed-out page", () => {
    const res = proxy(request("/dashboard"));
    expect(res.status).toBe(307);
    const location = new URL(res.headers.get("location")!);
    expect(location.pathname).toBe("/signed-out");
    expect(location.searchParams.get("from")).toBe("/dashboard");
  });

  // "/" redirects to /dashboard, so exempting it sent an anonymous visitor
  // round /dashboard -> gate -> / -> /dashboard forever. The destination has
  // to be a page that is public AND doesn't redirect.
  it("gates / rather than bouncing it, and lands somewhere terminal", () => {
    const root = proxy(request("/"));
    expect(root.status).toBe(307);
    expect(new URL(root.headers.get("location")!).pathname).toBe("/signed-out");
    // The destination must itself pass, or the loop just moves.
    expect(passedThrough(proxy(request("/signed-out")))).toBe(true);
  });

  it("401s an anonymous API request", async () => {
    const res = proxy(request("/api/decks"));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthenticated" });
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it.each([
    ["a forged cookie", "not-a-token"],
    ["a token signed with the wrong secret", mintIdentityToken("a-different-secret-16+", { sub: "x" })],
    ["a token with a tampered payload", `${validToken().split(".")[0]}.evil.${validToken().split(".")[2]}`],
  ])("rejects %s", (_label, token) => {
    expect(proxy(request("/api/decks", token)).status).toBe(401);
  });

  it("rejects an expired session", () => {
    const expired = mintIdentityToken(SECRET, {
      sub: "hosa_1",
      ttlSeconds: 60,
      now: Math.floor(Date.now() / 1000) - 3600,
    });
    expect(proxy(request("/dashboard", expired)).status).toBe(307);
  });

  it.each([
    "/signed-out",
    "/sample.pdf",
    "/pdf.worker.min.mjs",
    "/embed",
    "/api/proxy",
    "/api/demo-token",
    "/api/auth/enter",
    "/api/auth/demo",
    "/api/auth/logout",
    "/api/auth/me",
  ])("leaves %s reachable without a session", (path) => {
    expect(passedThrough(proxy(request(path)))).toBe(true);
  });

  // The public list is exact paths, not prefixes — otherwise a route like
  // /api/proxy-admin would inherit the exemption.
  it.each(["/api/proxy-admin", "/embed-secret", "/api/auth/enter/extra"])(
    "does not extend a public path's exemption to %s",
    (path) => {
      expect(proxy(request(path)).status).not.toBe(200);
    },
  );
});

describe("proxy — standalone demo (no secret)", () => {
  beforeEach(() => vi.stubEnv("VITALS_AUTH_SECRET", ""));
  afterEach(() => vi.unstubAllEnvs());

  it("waves everything through so local dev works without the main site", () => {
    expect(passedThrough(proxy(request("/dashboard")))).toBe(true);
    expect(passedThrough(proxy(request("/api/decks")))).toBe(true);
  });

  it("treats a too-short secret as unconfigured rather than half-enforcing", () => {
    vi.stubEnv("VITALS_AUTH_SECRET", "short");
    expect(passedThrough(proxy(request("/dashboard")))).toBe(true);
  });
});
