import { describe, expect, it } from "vitest";

import { isAllowedSource, isPrivateHost } from "./source-guard";

describe("isPrivateHost", () => {
  it.each([
    "localhost",
    "0.0.0.0",
    "127.0.0.1",
    "10.0.0.5",
    "172.16.3.4",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254", // cloud metadata
    "service.local",
    "db.internal",
    "::1",
    "fe80::1",
    "fd00::1",
  ])("blocks %s", (h) => {
    expect(isPrivateHost(h)).toBe(true);
  });

  it.each([
    "example.com",
    "bucket.r2.cloudflarestorage.com",
    "8.8.8.8",
    "172.32.0.1", // just outside the private 172.16–31 range
    "172.15.0.1",
    "vellum-rust.vercel.app",
  ])("allows %s", (h) => {
    expect(isPrivateHost(h)).toBe(false);
  });
});

describe("isAllowedSource", () => {
  const HOST = "vellum-rust.vercel.app";

  it("allows a public https source", () => {
    expect(isAllowedSource("https://bucket.r2.cloudflarestorage.com/doc.pdf?sig=x", HOST)).toBe(true);
  });

  it("allows a same-origin source even on localhost (the demo case)", () => {
    expect(isAllowedSource("http://localhost:3000/sample.pdf", "localhost:3000")).toBe(true);
  });

  it("blocks a cross-origin private host (SSRF attempt)", () => {
    expect(isAllowedSource("http://169.254.169.254/latest/meta-data/", HOST)).toBe(false);
    expect(isAllowedSource("http://10.0.0.1/secret", HOST)).toBe(false);
  });

  it("blocks non-http(s) schemes", () => {
    expect(isAllowedSource("file:///etc/passwd", HOST)).toBe(false);
    expect(isAllowedSource("ftp://example.com/x", HOST)).toBe(false);
  });

  it("rejects unparseable input", () => {
    expect(isAllowedSource("not a url", HOST)).toBe(false);
  });
});
