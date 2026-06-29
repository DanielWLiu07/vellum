import { beforeEach, describe, expect, it } from "vitest";

import { addUpload, deleteDoc, getDoc, getDocBytes, listDocs } from "./store";

const bytes = (n = 4) => new Uint8Array(n).fill(0x25);

describe("document store (memory backend)", () => {
  beforeEach(async () => {
    // Clear any uploads from prior tests (bundled samples stay).
    for (const d of await listDocs()) if (!d.bundled) await deleteDoc(d.id);
  });

  it("seeds the bundled sample and lists it first", async () => {
    const docs = await listDocs();
    expect(docs.some((d) => d.bundled && d.id === "sample")).toBe(true);
    expect(docs[0]!.bundled).toBe(true);
  });

  it("stores an upload and retrieves its metadata + bytes by id", async () => {
    const meta = await addUpload("notes.pdf", bytes(10));
    expect(meta.id).toMatch(/^u_/);
    expect(meta.bundled).toBe(false);

    const got = await getDoc(meta.id);
    expect(got?.sizeBytes).toBe(10);

    const raw = await getDocBytes(meta.id);
    expect(raw?.byteLength).toBe(10);
  });

  it("does not return bytes for bundled samples (served via publicPath)", async () => {
    const sample = await getDoc("sample");
    expect(sample?.publicPath).toBe("/sample.pdf");
    expect(await getDocBytes("sample")).toBeUndefined();
  });

  it("refuses to delete a bundled sample but deletes uploads", async () => {
    expect(await deleteDoc("sample")).toBe(false);
    const m = await addUpload("x.pdf", bytes());
    expect(await deleteDoc(m.id)).toBe(true);
    expect(await getDoc(m.id)).toBeUndefined();
  });

  it("caps uploads so a warm instance can't grow unbounded", async () => {
    for (let i = 0; i < 30; i++) await addUpload(`f${i}.pdf`, bytes());
    const uploads = (await listDocs()).filter((d) => !d.bundled);
    expect(uploads.length).toBeLessThanOrEqual(25);
  });
});
