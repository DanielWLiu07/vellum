import { beforeEach, describe, expect, it } from "vitest";

import { addUpload, deleteDoc, getDoc, listDocs } from "./store";

const bytes = (n = 4) => new Uint8Array(n).fill(0x25);

describe("document store", () => {
  beforeEach(() => {
    // Clear any uploads from prior tests (bundled samples stay).
    for (const d of listDocs()) if (!d.bundled) deleteDoc(d.id);
  });

  it("seeds the bundled sample and lists it first", () => {
    const docs = listDocs();
    expect(docs.some((d) => d.bundled && d.id === "sample")).toBe(true);
    expect(docs[0]!.bundled).toBe(true);
  });

  it("stores an upload and retrieves it by id", () => {
    const meta = addUpload("notes.pdf", bytes(10));
    expect(meta.id).toMatch(/^u_/);
    expect(meta.bundled).toBe(false);
    expect(getDoc(meta.id)?.sizeBytes).toBe(10);
  });

  it("refuses to delete a bundled sample but deletes uploads", () => {
    expect(deleteDoc("sample")).toBe(false);
    const m = addUpload("x.pdf", bytes());
    expect(deleteDoc(m.id)).toBe(true);
    expect(getDoc(m.id)).toBeUndefined();
  });

  it("caps uploads so a warm instance can't grow unbounded", () => {
    for (let i = 0; i < 30; i++) addUpload(`f${i}.pdf`, bytes());
    expect(listDocs().filter((d) => !d.bundled).length).toBeLessThanOrEqual(25);
  });
});
