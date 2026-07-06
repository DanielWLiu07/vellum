import { beforeEach, describe, expect, it } from "vitest";

import { setShare } from "./resource-share";
import { addUpload, copyDoc, deleteDoc, getDoc, getDocBytes, listDocs } from "./store";

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
    for (let i = 0; i < 30; i++) await addUpload(`f${i}.pdf`, bytes(), "application/pdf", {
      visibility: "private", chapter: "", owner: "you",
    });
    const uploads = (await listDocs()).filter((d) => !d.bundled);
    expect(uploads.length).toBeLessThanOrEqual(25);
  });

  it("eviction only touches the NEW owner's uploads (a copy can't evict others)", async () => {
    // A victim's single doc, then flood with the attacker's uploads past cap.
    const victim = await addUpload("victim.pdf", bytes(), "application/pdf", {
      visibility: "public", chapter: "", owner: "victim",
    });
    for (let i = 0; i < 30; i++) await addUpload(`spam${i}.pdf`, bytes(), "application/pdf", {
      visibility: "private", chapter: "", owner: "attacker",
    });
    // The victim's doc survives; only the attacker's own oldest were evicted.
    expect(await getDoc(victim.id)).toBeDefined();
    const attackerDocs = (await listDocs()).filter((d) => d.owner === "attacker");
    expect(attackerDocs.length).toBeLessThanOrEqual(25);
  });

  it("composes people + rename from the share sidecar", async () => {
    const m = await addUpload("orig.pdf", bytes());
    setShare(m.id, { name: "Renamed.pdf", people: [{ person: "Ava", role: "editor" }] });
    const got = await getDoc(m.id);
    expect(got?.name).toBe("Renamed.pdf");
    expect(got?.people).toEqual([{ person: "Ava", role: "editor" }]);
  });

  it("copyDoc clones an upload's bytes as a private doc owned by the caller", async () => {
    const src = await addUpload("src.pdf", bytes(12), "application/pdf", {
      visibility: "public",
      chapter: "",
      owner: "someone",
    });
    const copy = await copyDoc(src.id, "you", "Toronto Central");
    expect(copy).toBeDefined();
    expect(copy!.name).toBe("Copy of src.pdf");
    expect(copy!.owner).toBe("you");
    expect(copy!.visibility).toBe("private");
    expect((await getDocBytes(copy!.id))?.byteLength).toBe(12);
    // Independent: deleting the source leaves the copy alive.
    await deleteDoc(src.id);
    expect(await getDoc(copy!.id)).toBeDefined();
  });

  it("copyDoc clones a bundled sample from /public (the editable-copy story)", async () => {
    const copy = await copyDoc("sample", "you", "Toronto Central");
    expect(copy).toBeDefined();
    expect(copy!.bundled).toBe(false);
    expect(copy!.name).toBe("Copy of Vitals - overview (sample)");
    expect(copy!.visibility).toBe("private");
    expect((await getDocBytes(copy!.id))?.byteLength).toBeGreaterThan(0);
  });

  it("copyDoc returns undefined for a missing doc", async () => {
    expect(await copyDoc("u_missing", "you", "TC")).toBeUndefined();
  });
});
