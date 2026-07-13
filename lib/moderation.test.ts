import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { flaggedReason, moderateImage, moderateText, moderationConfigured } from "./moderation";

const KEY = "OPENAI_API_KEY";

// A fetch mock whose resolved value we control; call args are inspectable via
// `.mock.calls[0][1].body`.
function mockFetch(json: unknown, ok = true) {
  return vi.fn().mockResolvedValue({ ok, json: async () => json });
}
function reqBody(fetchMock: ReturnType<typeof mockFetch>) {
  return JSON.parse(fetchMock.mock.calls[0][1].body);
}
const SKIPPED = { allowed: true, flagged: false, categories: [], checked: false };

describe("moderation", () => {
  const original = process.env[KEY];
  afterEach(() => {
    if (original === undefined) delete process.env[KEY];
    else process.env[KEY] = original;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  describe("moderationConfigured", () => {
    it("true when a key is set", () => {
      process.env[KEY] = "sk-test";
      expect(moderationConfigured()).toBe(true);
    });
    it("false when unset", () => {
      delete process.env[KEY];
      expect(moderationConfigured()).toBe(false);
    });
    it("false for an empty-string key", () => {
      process.env[KEY] = "";
      expect(moderationConfigured()).toBe(false);
    });
  });

  describe("flaggedReason", () => {
    it("empty categories -> empty string", () => {
      expect(flaggedReason({ allowed: true, flagged: false, categories: [], checked: true })).toBe("");
    });
    it("single category", () => {
      expect(flaggedReason({ allowed: false, flagged: true, categories: ["hate"], checked: true })).toBe("hate");
    });
    it("multiple categories joined by comma", () => {
      expect(
        flaggedReason({ allowed: false, flagged: true, categories: ["violence", "hate"], checked: true }),
      ).toBe("violence, hate");
    });
  });

  describe("moderateText", () => {
    describe("keyless", () => {
      beforeEach(() => delete process.env[KEY]);
      it("skips and never calls the API", async () => {
        const fetchSpy = vi.spyOn(global, "fetch");
        expect(await moderateText("anything")).toEqual(SKIPPED);
        expect(fetchSpy).not.toHaveBeenCalled();
      });
    });

    describe("with a key", () => {
      beforeEach(() => (process.env[KEY] = "sk-test"));

      it("returns CHECKED clean for empty input without calling the API", async () => {
        const fetchSpy = vi.spyOn(global, "fetch");
        expect(await moderateText("")).toEqual({ allowed: true, flagged: false, categories: [], checked: true });
        expect(fetchSpy).not.toHaveBeenCalled();
      });

      it("treats whitespace-only as empty (no API call)", async () => {
        const fetchSpy = vi.spyOn(global, "fetch");
        const r = await moderateText("   \n\t  ");
        expect(r.checked).toBe(true);
        expect(r.allowed).toBe(true);
        expect(fetchSpy).not.toHaveBeenCalled();
      });

      it("allows clean content and sends the right model + string input", async () => {
        const f = mockFetch({ results: [{ flagged: false, categories: {} }] });
        vi.stubGlobal("fetch", f);
        const r = await moderateText("the cell is the basic unit of life");
        expect(r).toEqual({ allowed: true, flagged: false, categories: [], checked: true });
        const body = reqBody(f);
        expect(body.model).toBe("omni-moderation-latest");
        expect(body.input).toBe("the cell is the basic unit of life");
      });

      it("blocks flagged content with a single category", async () => {
        vi.stubGlobal("fetch", mockFetch({ results: [{ flagged: true, categories: { hate: true } }] }));
        const r = await moderateText("bad");
        expect(r).toEqual({ allowed: false, flagged: true, categories: ["hate"], checked: true });
      });

      it("keeps only the TRUE categories when flagged", async () => {
        vi.stubGlobal(
          "fetch",
          mockFetch({ results: [{ flagged: true, categories: { violence: true, hate: true, sexual: false } }] }),
        );
        const r = await moderateText("bad");
        expect(r.categories.sort()).toEqual(["hate", "violence"]);
      });

      it("flagged:true but no true categories -> flagged, empty categories", async () => {
        vi.stubGlobal("fetch", mockFetch({ results: [{ flagged: true, categories: { hate: false } }] }));
        const r = await moderateText("edge");
        expect(r.flagged).toBe(true);
        expect(r.allowed).toBe(false);
        expect(r.categories).toEqual([]);
      });

      it("missing categories object -> flagged, empty categories", async () => {
        vi.stubGlobal("fetch", mockFetch({ results: [{ flagged: true }] }));
        const r = await moderateText("edge");
        expect(r.flagged).toBe(true);
        expect(r.categories).toEqual([]);
      });

      it("truncates very long text to the input cap", async () => {
        const f = mockFetch({ results: [{ flagged: false, categories: {} }] });
        vi.stubGlobal("fetch", f);
        await moderateText("a".repeat(60_000));
        expect(reqBody(f).input.length).toBe(40_000);
      });

      it("fails OPEN on a non-ok response", async () => {
        vi.stubGlobal("fetch", mockFetch({}, false));
        expect(await moderateText("x")).toEqual(SKIPPED);
      });

      it("fails OPEN when the response has no results", async () => {
        vi.stubGlobal("fetch", mockFetch({}));
        expect(await moderateText("x")).toEqual(SKIPPED);
      });

      it("fails OPEN when results is an empty array", async () => {
        vi.stubGlobal("fetch", mockFetch({ results: [] }));
        expect(await moderateText("x")).toEqual(SKIPPED);
      });

      it("fails OPEN when fetch rejects (network/timeout)", async () => {
        vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("boom")));
        expect(await moderateText("x")).toEqual(SKIPPED);
      });

      it("fails OPEN when json() throws (malformed body)", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => { throw new Error("bad json"); } }));
        expect(await moderateText("x")).toEqual(SKIPPED);
      });
    });
  });

  describe("moderateImage", () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);

    describe("keyless", () => {
      beforeEach(() => delete process.env[KEY]);
      it("skips without calling the API", async () => {
        const fetchSpy = vi.spyOn(global, "fetch");
        expect(await moderateImage(png, "image/png")).toEqual(SKIPPED);
        expect(fetchSpy).not.toHaveBeenCalled();
      });
    });

    describe("with a key", () => {
      beforeEach(() => (process.env[KEY] = "sk-test"));

      it("skips empty bytes without an API call", async () => {
        const fetchSpy = vi.spyOn(global, "fetch");
        expect(await moderateImage(new Uint8Array(0), "image/png")).toEqual(SKIPPED);
        expect(fetchSpy).not.toHaveBeenCalled();
      });

      it("skips oversized images (over 8 MB) without an API call", async () => {
        const fetchSpy = vi.spyOn(global, "fetch");
        expect(await moderateImage(new Uint8Array(9 * 1024 * 1024), "image/png")).toEqual(SKIPPED);
        expect(fetchSpy).not.toHaveBeenCalled();
      });

      it("allows a clean image and sends an image_url data URL", async () => {
        const f = mockFetch({ results: [{ flagged: false, categories: {} }] });
        vi.stubGlobal("fetch", f);
        const r = await moderateImage(png, "image/png");
        expect(r).toEqual({ allowed: true, flagged: false, categories: [], checked: true });
        const body = reqBody(f);
        expect(body.model).toBe("omni-moderation-latest");
        expect(Array.isArray(body.input)).toBe(true);
        expect(body.input[0].type).toBe("image_url");
        expect(body.input[0].image_url.url).toMatch(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/);
      });

      it("reflects the content type in the data URL", async () => {
        for (const ct of ["image/jpeg", "image/gif", "image/webp"]) {
          const f = mockFetch({ results: [{ flagged: false, categories: {} }] });
          vi.stubGlobal("fetch", f);
          await moderateImage(png, ct);
          expect(reqBody(f).input[0].image_url.url.startsWith(`data:${ct};base64,`)).toBe(true);
          vi.unstubAllGlobals();
        }
      });

      it("blocks a flagged image with its categories", async () => {
        vi.stubGlobal("fetch", mockFetch({ results: [{ flagged: true, categories: { violence: true } }] }));
        const r = await moderateImage(png, "image/png");
        expect(r.allowed).toBe(false);
        expect(r.categories).toEqual(["violence"]);
      });

      it("fails OPEN on a non-ok response", async () => {
        vi.stubGlobal("fetch", mockFetch({}, false));
        expect(await moderateImage(png, "image/png")).toEqual(SKIPPED);
      });

      it("fails OPEN when fetch rejects", async () => {
        vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("net")));
        expect(await moderateImage(png, "image/png")).toEqual(SKIPPED);
      });
    });
  });
});
