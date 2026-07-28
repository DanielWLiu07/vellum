// Preview route: renders a PDF's first page (cached), passes images through,
// and 404s on anything not viewable / opted-out / unrenderable so cards fall
// back to the placeholder.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const store = vi.hoisted(() => ({ getDoc: vi.fn(), getDocBytes: vi.fn() }));
vi.mock("@/lib/store", () => store);

const pdf = vi.hoisted(() => ({ renderPdfPageImage: vi.fn() }));
vi.mock("@/lib/pdf-content", () => pdf);

import { GET } from "./route";
import { __resetPreviewCache } from "@/lib/preview-cache";
import { __resetProfile } from "@/lib/profile";

type DocOver = Record<string, unknown>;
const makeDoc = (over: DocOver) => ({
  id: "d", name: "Doc", contentType: "application/pdf",
  visibility: "public", chapter: "", owner: "you", people: [], bundled: false,
  sizeBytes: 10, uploadedAt: 0, ...over,
});
const call = (id: string) =>
  GET(new NextRequest(`https://v.test/api/doc/${id}/preview`), { params: Promise.resolve({ id }) });

beforeEach(() => {
  process.env.VELLUM_DEMO_MODE = "1";
  __resetProfile();
  __resetPreviewCache();
  store.getDocBytes.mockResolvedValue(new Uint8Array([0x25, 0x50, 0x44, 0x46]));
  pdf.renderPdfPageImage.mockResolvedValue(new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
});
afterEach(() => {
  delete process.env.VELLUM_DEMO_MODE;
  vi.clearAllMocks();
});

describe("GET preview", () => {
  it("renders a PDF's first page and caches it (renders once)", async () => {
    store.getDoc.mockResolvedValue(makeDoc({ id: "pdf1" }));
    const r1 = await call("pdf1");
    expect(r1.status).toBe(200);
    expect(r1.headers.get("Content-Type")).toBe("image/png");
    expect(r1.headers.get("X-Content-Type-Options")).toBe("nosniff");
    const r2 = await call("pdf1");
    expect(r2.status).toBe(200);
    expect(pdf.renderPdfPageImage).toHaveBeenCalledTimes(1); // second hit served from cache
  });

  it("passes an image through as its own type (no render)", async () => {
    store.getDoc.mockResolvedValue(makeDoc({ id: "img1", contentType: "image/png" }));
    store.getDocBytes.mockResolvedValue(new Uint8Array([0x89, 0x50]));
    const res = await call("img1");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png");
    expect(pdf.renderPdfPageImage).not.toHaveBeenCalled();
  });

  it("404s when the doc opted out of previews", async () => {
    store.getDoc.mockResolvedValue(makeDoc({ id: "np", noPreview: true }));
    expect((await call("np")).status).toBe(404);
    expect(pdf.renderPdfPageImage).not.toHaveBeenCalled();
  });

  it("404s a doc the viewer cannot see (no existence leak)", async () => {
    store.getDoc.mockResolvedValue(makeDoc({ id: "priv", visibility: "private", owner: "someone-else" }));
    expect((await call("priv")).status).toBe(404);
  });

  it("404s a missing doc", async () => {
    store.getDoc.mockResolvedValue(undefined);
    expect((await call("gone")).status).toBe(404);
  });

  it("404s (not 500) when the PDF will not render", async () => {
    store.getDoc.mockResolvedValue(makeDoc({ id: "bad" }));
    pdf.renderPdfPageImage.mockRejectedValue(new Error("corrupt"));
    expect((await call("bad")).status).toBe(404);
  });

  it("404s when the dashboard is disabled", async () => {
    delete process.env.VELLUM_DEMO_MODE;
    store.getDoc.mockResolvedValue(makeDoc({ id: "x" }));
    expect((await call("x")).status).toBe(404);
  });
});
