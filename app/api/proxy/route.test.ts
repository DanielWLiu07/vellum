import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { POST } from "./route";
import { mintToken } from "@/lib/token";

const SECRET = "proxy-test-secret-at-least-16-chars";
const HOST = "https://vellum-rust.vercel.app/api/proxy";

function reqWith(body: unknown): NextRequest {
  return new NextRequest(HOST, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]); // %PDF-

beforeEach(() => {
  process.env.VELLUM_TOKEN_SECRET = SECRET;
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("POST /api/proxy — auth + token", () => {
  it("500s when the service isn't configured", async () => {
    delete process.env.VELLUM_TOKEN_SECRET;
    const res = await POST(reqWith({ t: "x" }));
    expect(res.status).toBe(500);
  });

  it("400s when no token is supplied", async () => {
    const res = await POST(reqWith({}));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("missing_token");
  });

  it("401s an invalid/tampered token", async () => {
    const res = await POST(reqWith({ t: "v1.tampered.sig" }));
    expect(res.status).toBe(401);
  });

  it("410s an expired token", async () => {
    const token = mintToken(SECRET, { src: "https://example.com/doc.pdf", ttlSeconds: 30, now: 1000 });
    const res = await POST(reqWith({ t: token }));
    expect(res.status).toBe(410);
    expect((await res.json()).error).toBe("expired");
  });
});

describe("POST /api/proxy — SSRF guard", () => {
  it("403s a token pointing at a private/internal host", async () => {
    const token = mintToken(SECRET, { src: "http://169.254.169.254/latest/meta-data/" });
    const res = await POST(reqWith({ t: token }));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("blocked_source");
  });
});

describe("POST /api/proxy — fetch + stream", () => {
  it("streams the document for a valid token + public source", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(PDF, { status: 200, headers: { "content-length": String(PDF.length) } }),
    ));
    const token = mintToken(SECRET, { src: "https://example.com/doc.pdf" });
    const res = await POST(reqWith({ t: token }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("cache-control")).toContain("no-store");
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(Array.from(bytes)).toEqual(Array.from(PDF));
  });

  it("502s when the source is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ECONNREFUSED"); }));
    const token = mintToken(SECRET, { src: "https://example.com/doc.pdf" });
    expect((await POST(reqWith({ t: token }))).status).toBe(502);
  });

  it("502s when the source responds non-OK", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 404 })));
    const token = mintToken(SECRET, { src: "https://example.com/doc.pdf" });
    expect((await POST(reqWith({ t: token }))).status).toBe(502);
  });

  it("413s when the source declares an oversize content-length", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(PDF, { status: 200, headers: { "content-length": String(200 * 1024 * 1024) } }),
    ));
    const token = mintToken(SECRET, { src: "https://example.com/doc.pdf" });
    expect((await POST(reqWith({ t: token }))).status).toBe(413);
  });
});
