import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mods = vi.hoisted(() => ({
  moderateText: vi.fn(),
  moderateImage: vi.fn(),
  moderationConfigured: vi.fn(),
}));
vi.mock("./moderation", () => mods);

const pdf = vi.hoisted(() => ({
  extractPdfText: vi.fn(),
  renderPdfPageImage: vi.fn(),
}));
vi.mock("./pdf-content", () => pdf);

import { moderatePdfContent } from "./pdf-moderation";

const allow = { allowed: true, flagged: false, categories: [] as string[], checked: true };
const flag = (cats: string[]) => ({ allowed: false, flagged: true, categories: cats, checked: true });
const bytes = new Uint8Array([1, 2, 3, 4]);

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.PDF_MODERATION_MAX_PAGES;
  mods.moderationConfigured.mockReturnValue(true);
  mods.moderateText.mockResolvedValue(allow);
  mods.moderateImage.mockResolvedValue(allow);
  pdf.extractPdfText.mockResolvedValue({ text: "page text", totalPages: 3 });
  pdf.renderPdfPageImage.mockResolvedValue(new Uint8Array([0x89, 0x50]));
});
afterEach(() => vi.restoreAllMocks());

describe("moderatePdfContent", () => {
  it("skips entirely when moderation is not configured (no extraction/render)", async () => {
    mods.moderationConfigured.mockReturnValue(false);
    const r = await moderatePdfContent(bytes);
    expect(r).toEqual({ allowed: true, flagged: false, categories: [], checked: false, pagesChecked: 0, totalPages: 0 });
    expect(pdf.extractPdfText).not.toHaveBeenCalled();
    expect(pdf.renderPdfPageImage).not.toHaveBeenCalled();
  });

  it("allows a clean PDF and reports every page checked", async () => {
    const r = await moderatePdfContent(bytes);
    expect(r.allowed).toBe(true);
    expect(r.checked).toBe(true);
    expect(r.totalPages).toBe(3);
    expect(r.pagesChecked).toBe(3);
    expect(mods.moderateText).toHaveBeenCalledOnce();
    expect(pdf.renderPdfPageImage).toHaveBeenCalledTimes(3);
    expect(mods.moderateImage).toHaveBeenCalledTimes(3);
  });

  it("blocks when the page TEXT is flagged", async () => {
    mods.moderateText.mockResolvedValue(flag(["hate"]));
    const r = await moderatePdfContent(bytes);
    expect(r.allowed).toBe(false);
    expect(r.categories).toContain("hate");
  });

  it("blocks when a page IMAGE is flagged (text clean)", async () => {
    mods.moderateImage.mockResolvedValueOnce(allow).mockResolvedValueOnce(flag(["violence"])).mockResolvedValue(allow);
    const r = await moderatePdfContent(bytes);
    expect(r.allowed).toBe(false);
    expect(r.categories).toContain("violence");
  });

  it("unions categories from text and multiple pages", async () => {
    mods.moderateText.mockResolvedValue(flag(["hate"]));
    mods.moderateImage.mockResolvedValueOnce(flag(["violence"])).mockResolvedValue(flag(["sexual"]));
    const r = await moderatePdfContent(bytes);
    expect(r.categories.sort()).toEqual(["hate", "sexual", "violence"]);
  });

  it("caps image moderation at PDF_MODERATION_MAX_PAGES but text still covers all pages", async () => {
    process.env.PDF_MODERATION_MAX_PAGES = "2";
    pdf.extractPdfText.mockResolvedValue({ text: "lots", totalPages: 10 });
    const r = await moderatePdfContent(bytes);
    expect(r.totalPages).toBe(10);
    expect(pdf.renderPdfPageImage).toHaveBeenCalledTimes(2); // capped
    expect(r.pagesChecked).toBe(2);
    expect(mods.moderateText).toHaveBeenCalledOnce(); // text pass still ran over all pages
  });

  it("fails OPEN when text extraction throws (no pages, allowed)", async () => {
    pdf.extractPdfText.mockRejectedValue(new Error("corrupt"));
    const r = await moderatePdfContent(bytes);
    expect(r.allowed).toBe(true);
    expect(r.totalPages).toBe(0);
    expect(pdf.renderPdfPageImage).not.toHaveBeenCalled();
  });

  it("skips a single un-renderable page but still checks the rest", async () => {
    pdf.renderPdfPageImage
      .mockResolvedValueOnce(new Uint8Array([1]))
      .mockRejectedValueOnce(new Error("bad page"))
      .mockResolvedValueOnce(new Uint8Array([1]));
    const r = await moderatePdfContent(bytes);
    expect(r.allowed).toBe(true);
    expect(r.pagesChecked).toBe(2); // page 2 failed to render, pages 1 and 3 checked
    expect(mods.moderateImage).toHaveBeenCalledTimes(2);
  });

  it("does not render images when the PDF has zero pages", async () => {
    pdf.extractPdfText.mockResolvedValue({ text: "", totalPages: 0 });
    const r = await moderatePdfContent(bytes);
    expect(pdf.renderPdfPageImage).not.toHaveBeenCalled();
    expect(r.pagesChecked).toBe(0);
  });
});
