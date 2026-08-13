import { describe, expect, it } from "vitest";

import { fetchAllowedSource, isAllowedSource, isPrivateHost } from "./source-guard";

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
    // Carrier-grade NAT (100.64/10) — where Tailscale and similar overlays live.
    "100.64.0.1",
    "100.127.255.255",
    // IPv4-mapped IPv6, both spellings. `new URL` emits the hex one.
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
    "[::ffff:7f00:1]",
    "::ffff:a00:1", // 10.0.0.1
    // RFC 6761 reserves .localhost for loopback.
    "evil.localhost",
  ])("blocks %s", (h) => {
    expect(isPrivateHost(h)).toBe(true);
  });

  it.each([
    "example.com",
    "bucket.r2.cloudflarestorage.com",
    "8.8.8.8",
    "172.32.0.1", // just outside the private 172.16-31 range
    "172.15.0.1",
    "vellum-rust.vercel.app",
    "100.63.255.255", // just below the CGNAT block
    "100.128.0.1", // just above it
    "::ffff:808:808", // mapped 8.8.8.8 — mapped does not mean private
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

describe("fetchAllowedSource", () => {
  const HOST = "vellum-rust.vercel.app";

  /** Stub fetch. Factories, not Responses — a body can only be read once. */
  function stub(routes: Record<string, () => Response>): {
    impl: typeof fetch;
    seen: string[];
  } {
    const seen: string[] = [];
    const impl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      seen.push(url);
      const make = routes[url];
      if (!make) throw new Error(`no stub for ${url}`);
      return make();
    }) as typeof fetch;
    return { impl, seen };
  }

  const redirect = (to: string, status = 302) => () =>
    new Response(null, { status, headers: { location: to } });
  const ok = (body = "%PDF-1.4") => () => new Response(body, { status: 200 });

  it("returns a terminal response with no redirect", async () => {
    const { impl } = stub({ "https://cdn.example.com/a.pdf": ok() });
    const res = await fetchAllowedSource("https://cdn.example.com/a.pdf", HOST, impl);
    expect(res.ok).toBe(true);
    if (res.ok) expect(await res.response.text()).toBe("%PDF-1.4");
  });

  it("follows a redirect between public hosts", async () => {
    const { impl, seen } = stub({
      "https://cdn.example.com/a.pdf": redirect("https://files.example.org/real.pdf"),
      "https://files.example.org/real.pdf": ok(),
    });
    const res = await fetchAllowedSource("https://cdn.example.com/a.pdf", HOST, impl);
    expect(res.ok).toBe(true);
    expect(seen).toHaveLength(2);
  });

  // The bug this function exists for: redirect: "follow" validated only the
  // first URL, so a public host could bounce the proxy straight into the
  // cloud metadata service.
  it("blocks a redirect from a public host into cloud metadata", async () => {
    const { impl, seen } = stub({
      "https://cdn.example.com/a.pdf": redirect("http://169.254.169.254/latest/meta-data/"),
    });
    const res = await fetchAllowedSource("https://cdn.example.com/a.pdf", HOST, impl);
    expect(res).toEqual({ ok: false, error: "blocked_source" });
    // Refused before the second request went out, not after.
    expect(seen).toEqual(["https://cdn.example.com/a.pdf"]);
  });

  it.each([
    ["private LAN", "http://10.0.0.1/secret"],
    ["loopback", "http://127.0.0.1:8080/admin"],
    ["mapped loopback", "http://[::ffff:7f00:1]/admin"],
    ["CGNAT peer", "http://100.64.0.7/"],
    ["non-http scheme", "file:///etc/passwd"],
  ])("blocks a redirect to a %s target", async (_label, target) => {
    const { impl } = stub({ "https://cdn.example.com/a.pdf": redirect(target) });
    const res = await fetchAllowedSource("https://cdn.example.com/a.pdf", HOST, impl);
    expect(res).toEqual({ ok: false, error: "blocked_source" });
  });

  it("resolves a relative Location against the current hop", async () => {
    const { impl, seen } = stub({
      "https://cdn.example.com/docs/a.pdf": redirect("../real/b.pdf"),
      "https://cdn.example.com/real/b.pdf": ok(),
    });
    const res = await fetchAllowedSource("https://cdn.example.com/docs/a.pdf", HOST, impl);
    expect(res.ok).toBe(true);
    expect(seen[1]).toBe("https://cdn.example.com/real/b.pdf");
  });

  it("refuses the initial source when it is already private", async () => {
    const { impl, seen } = stub({});
    const res = await fetchAllowedSource("http://169.254.169.254/", HOST, impl);
    expect(res).toEqual({ ok: false, error: "blocked_source" });
    expect(seen).toEqual([]); // never dialled out
  });

  it("tolerates a 5-hop chain but gives up on the 6th", async () => {
    const chain = (n: number): Record<string, () => Response> => {
      const routes: Record<string, () => Response> = {};
      for (let i = 0; i < n; i++) {
        routes[`https://h${i}.example.com/`] = redirect(`https://h${i + 1}.example.com/`);
      }
      routes[`https://h${n}.example.com/`] = ok();
      return routes;
    };

    const five = stub(chain(5));
    expect((await fetchAllowedSource("https://h0.example.com/", HOST, five.impl)).ok).toBe(true);

    const six = stub(chain(6));
    expect(await fetchAllowedSource("https://h0.example.com/", HOST, six.impl)).toEqual({
      ok: false,
      error: "too_many_redirects",
    });
  });

  it.each([301, 303, 307, 308])("treats %i as a redirect too", async (status) => {
    const { impl } = stub({
      "https://cdn.example.com/a.pdf": redirect("http://10.0.0.1/x", status),
    });
    const res = await fetchAllowedSource("https://cdn.example.com/a.pdf", HOST, impl);
    expect(res).toEqual({ ok: false, error: "blocked_source" });
  });

  it("reports an unreachable source rather than throwing", async () => {
    const impl = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    const res = await fetchAllowedSource("https://cdn.example.com/a.pdf", HOST, impl);
    expect(res).toEqual({ ok: false, error: "source_unreachable" });
  });

  it("treats a redirect with no Location as unreachable", async () => {
    const { impl } = stub({
      "https://cdn.example.com/a.pdf": () => new Response(null, { status: 302 }),
    });
    const res = await fetchAllowedSource("https://cdn.example.com/a.pdf", HOST, impl);
    expect(res).toEqual({ ok: false, error: "source_unreachable" });
  });

  it("passes a non-2xx terminal response back for the caller to judge", async () => {
    const { impl } = stub({
      "https://cdn.example.com/a.pdf": () => new Response("nope", { status: 404 }),
    });
    const res = await fetchAllowedSource("https://cdn.example.com/a.pdf", HOST, impl);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.response.status).toBe(404);
  });
});
