// Who am I: the client's identity lookup. Carries the chapter ID (the scoping
// key) and the chapter DISPLAY name separately, so nothing renders a cuid.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";

import { GET } from "./route";
import { SESSION_COOKIE } from "@/lib/auth";
import { mintIdentityToken } from "@/lib/identity-token";

const SECRET = "shared-secret-at-least-16-chars";

const call = (token?: string) =>
  GET(new NextRequest("https://v.test/api/auth/me", {
    headers: token ? { Cookie: `${SESSION_COOKIE}=${token}` } : {},
  }));

beforeEach(() => { process.env.VITALS_AUTH_SECRET = SECRET; });
afterEach(() => { delete process.env.VITALS_AUTH_SECRET; });

describe("GET /api/auth/me", () => {
  it("returns the chapter id and its display name separately", async () => {
    const token = mintIdentityToken(SECRET, {
      sub: "hosa_7", name: "Ada", chapter: "clx3k2p9f0001", chapterName: "Toronto Central", role: "student",
    });
    const body = await (await call(token)).json();
    expect(body).toMatchObject({
      signedIn: true,
      id: "hosa_7",
      name: "Ada",
      chapter: "clx3k2p9f0001",
      chapterName: "Toronto Central",
      role: "student",
    });
  });

  it("sends an empty chapterName for a legacy token, so the client falls back to the id", async () => {
    const token = mintIdentityToken(SECRET, { sub: "hosa_8", name: "Liam", chapter: "clx_legacy", role: "student" });
    const body = await (await call(token)).json();
    expect(body.chapterName).toBe("");
    expect(body.chapterName || body.chapter).toBe("clx_legacy");
  });

  it("reports a signed-out visitor without inventing an identity", async () => {
    const body = await (await call()).json();
    expect(body.signedIn).toBe(false);
    expect(body.id).toBeUndefined();
  });

  it("treats a tampered cookie as signed out", async () => {
    const forged = mintIdentityToken("some-other-secret-16chars!!", { sub: "attacker", role: "admin" });
    expect((await (await call(forged)).json()).signedIn).toBe(false);
  });
});
