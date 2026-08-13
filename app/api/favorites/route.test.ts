// Favorites API: the current viewer can list, save, unsave, and toggle a
// resource they can see. Guards (existence, visibility, rate limit, disabled
// mode, bad body) hold.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { GET, POST } from "./route";
import { createDeck, deleteDeck } from "@/lib/decks";
import { __resetFavorites } from "@/lib/favorites";
import { __resetProfile } from "@/lib/profile";
import { __resetRateLimit } from "@/lib/rate-limit";
import { setShare } from "@/lib/resource-share";

// The bundled sample: public, always present, and owned by nobody in
// particular — the one id every viewer can see without any setup.
const SAMPLE = "sample";

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
    const res = await POST(postReq({ id: SAMPLE, favorite: true }));
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j).toMatchObject({ id: SAMPLE, favorite: true, count: 1 });
    const list = await (await GET(new NextRequest("https://v.test/x"))).json();
    expect(list.ids).toEqual([SAMPLE]);
    expect(list.counts).toMatchObject({ [SAMPLE]: 1 }); // global like-count exposed to the client
  });

  it("unsaves when favorite is false", async () => {
    await POST(postReq({ id: SAMPLE, favorite: true }));
    const res = await POST(postReq({ id: SAMPLE, favorite: false }));
    expect((await res.json())).toMatchObject({ favorite: false, count: 0 });
    expect((await (await GET(new NextRequest("https://v.test/x"))).json()).ids).toEqual([]);
  });

  it("toggles when favorite is omitted", async () => {
    expect((await (await POST(postReq({ id: SAMPLE }))).json()).favorite).toBe(true);
    expect((await (await POST(postReq({ id: SAMPLE }))).json()).favorite).toBe(false);
  });

  it("saves a deck as well as a document", async () => {
    const deck = createDeck("Cardiac rhythms", [{ front: "a", back: "b" }], "you");
    try {
      setShare(deck.id, { visibility: "public" }, { visibility: "private", chapter: "" }, "you");
      expect((await POST(postReq({ id: deck.id, favorite: true }))).status).toBe(200);
    } finally {
      deleteDeck(deck.id);
    }
  });

  it("rejects a body with no id (400)", async () => {
    expect((await POST(postReq({ favorite: true }))).status).toBe(400);
    expect((await POST(postReq("not json"))).status).toBe(400);
  });

  // This route writes into a store that is persisted on every change and read
  // back as a public like-count, so an id that names nothing is not a harmless
  // no-op: it is unbounded growth, and a number other members are shown.
  it("404s an id that names no resource, and writes nothing", async () => {
    const res = await POST(postReq({ id: "u_does_not_exist", favorite: true }));
    expect(res.status).toBe(404);
    const list = await (await GET(new NextRequest("https://v.test/x"))).json();
    expect(list.ids).toEqual([]);
    expect(list.counts).toEqual({});
  });

  // Someone else's private deck exists, so an existence check alone would let
  // its like-count be moved by a member who cannot open it. 404 rather than
  // 403, so this can't be used to find out which ids are real either.
  it("404s a resource the viewer cannot see, rather than counting it", async () => {
    const deck = createDeck("Private notes", [{ front: "a", back: "b" }], "someone_else");
    try {
      // A deck with no share sidecar reads as public (lib/decks withScope), so
      // the scope has to be written for this to be the case it claims to be.
      setShare(deck.id, { visibility: "private" }, { visibility: "private", chapter: "" }, "someone_else");
      const res = await POST(postReq({ id: deck.id, favorite: true }));
      expect(res.status).toBe(404);
      expect((await (await GET(new NextRequest("https://v.test/x"))).json()).counts).toEqual({});
    } finally {
      deleteDeck(deck.id);
    }
  });

  it("rate-limits after the per-window cap", async () => {
    let last = 200;
    for (let i = 0; i < 65; i++) last = (await POST(postReq({ id: SAMPLE }))).status;
    expect(last).toBe(429);
  });

  it("404s when the dashboard is disabled", async () => {
    delete process.env.VELLUM_DEMO_MODE;
    expect((await POST(postReq({ id: SAMPLE }))).status).toBe(404);
  });
});
