// Integration test: exercises the REAL unpdf + @napi-rs/canvas pipeline against
// the bundled sample PDF (no mocks), proving text extraction and page rendering
// actually work in this environment.

import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { extractPdfText, renderPdfPageImage } from "./pdf-content";

async function sample() {
  return new Uint8Array(await readFile("public/sample.pdf"));
}

describe("pdf-content (real sample.pdf)", () => {
  it("extracts text and reports the page count", async () => {
    const { text, totalPages } = await extractPdfText(await sample());
    expect(totalPages).toBeGreaterThan(0);
    expect(text.length).toBeGreaterThan(0);
    expect(text.toLowerCase()).toContain("document");
  });

  it("renders a page to valid PNG bytes", async () => {
    const png = await renderPdfPageImage(await sample(), 1);
    expect(png).toBeInstanceOf(Uint8Array);
    expect(png.byteLength).toBeGreaterThan(100);
    // PNG magic number.
    expect(png[0]).toBe(0x89);
    expect(png[1]).toBe(0x50);
    expect(png[2]).toBe(0x4e);
    expect(png[3]).toBe(0x47);
  });
}, 30_000);
