// R2 backend logic, exercised against a fake in-memory S3 (the AWS SDK is
// mocked). Verifies put/head/getBytes/list/remove, the upload cap, metadata
// (name) round-tripping, and missing-object handling — without a real bucket.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const bucket = new Map<
    string,
    { Body: Uint8Array; Metadata: Record<string, string>; size: number; lastModified: Date }
  >();
  let clock = 0;
  return { bucket, tick: () => ++clock };
});

vi.mock("@aws-sdk/client-s3", () => {
  class Cmd {
    constructor(public input: Record<string, unknown>) {}
  }
  class PutObjectCommand extends Cmd {}
  class HeadObjectCommand extends Cmd {}
  class GetObjectCommand extends Cmd {}
  class ListObjectsV2Command extends Cmd {}
  class DeleteObjectCommand extends Cmd {}

  const missing = (name: string) => {
    const e = new Error("missing");
    e.name = name;
    return e;
  };

  class S3Client {
    async send(cmd: Cmd) {
      const i = cmd.input as Record<string, string> & { Body?: Uint8Array };
      if (cmd instanceof PutObjectCommand) {
        h.bucket.set(i.Key, {
          Body: i.Body!,
          Metadata: (i as unknown as { Metadata: Record<string, string> }).Metadata,
          size: i.Body!.byteLength,
          lastModified: new Date(h.tick() * 1000),
        });
        return {};
      }
      if (cmd instanceof HeadObjectCommand) {
        const o = h.bucket.get(i.Key);
        if (!o) throw missing("NotFound");
        return { Metadata: o.Metadata, ContentLength: o.size, LastModified: o.lastModified };
      }
      if (cmd instanceof GetObjectCommand) {
        const o = h.bucket.get(i.Key);
        if (!o) throw missing("NoSuchKey");
        return { Body: { transformToByteArray: async () => o.Body } };
      }
      if (cmd instanceof ListObjectsV2Command) {
        const Contents = [...h.bucket.entries()]
          .filter(([k]) => k.startsWith(i.Prefix))
          .map(([Key, o]) => ({ Key, Size: o.size, LastModified: o.lastModified }));
        return { Contents };
      }
      if (cmd instanceof DeleteObjectCommand) {
        h.bucket.delete(i.Key);
        return {};
      }
      throw new Error("unexpected command");
    }
  }

  return {
    S3Client,
    PutObjectCommand,
    HeadObjectCommand,
    GetObjectCommand,
    ListObjectsV2Command,
    DeleteObjectCommand,
  };
});

import { r2Backend } from "./r2";
import { backend, r2Configured } from "./index";

const bytes = (n = 4) => new Uint8Array(n).fill(0x25);

beforeEach(() => {
  h.bucket.clear();
  process.env.R2_ENDPOINT = "https://acct.r2.cloudflarestorage.com";
  process.env.R2_BUCKET = "vellum";
  process.env.R2_ACCESS_KEY_ID = "key";
  process.env.R2_SECRET_ACCESS_KEY = "secret";
});

afterEach(() => {
  // Don't leak R2 config into other test files (they expect the memory backend).
  delete process.env.R2_ENDPOINT;
  delete process.env.R2_BUCKET;
  delete process.env.R2_ACCESS_KEY_ID;
  delete process.env.R2_SECRET_ACCESS_KEY;
});

describe("r2Backend", () => {
  it("puts an object and reads back its metadata + bytes", async () => {
    const meta = await r2Backend.put("résumé (1).pdf", bytes(12));
    expect(meta.id).toMatch(/^u_/);
    expect(meta.sizeBytes).toBe(12);

    const head = await r2Backend.head(meta.id);
    expect(head?.name).toBe("résumé (1).pdf"); // metadata round-trips through encodeURIComponent
    expect(head?.sizeBytes).toBe(12);

    const raw = await r2Backend.getBytes(meta.id);
    expect(raw?.byteLength).toBe(12);
  });

  it("returns undefined for a missing object (head + getBytes)", async () => {
    expect(await r2Backend.head("u_nope")).toBeUndefined();
    expect(await r2Backend.getBytes("u_nope")).toBeUndefined();
  });

  it("lists uploads newest-first", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(1_000_000));
      const a = await r2Backend.put("a.pdf", bytes());
      vi.setSystemTime(new Date(2_000_000));
      const b = await r2Backend.put("b.pdf", bytes());
      const list = await r2Backend.list();
      expect(list.map((m) => m.id)).toEqual([b.id, a.id]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("removes an object (and reports whether it existed)", async () => {
    const m = await r2Backend.put("x.pdf", bytes());
    expect(await r2Backend.remove(m.id)).toBe(true);
    expect(await r2Backend.head(m.id)).toBeUndefined();
    expect(await r2Backend.remove("u_nope")).toBe(false);
  });

  it("evicts the oldest beyond the 25-upload cap", async () => {
    for (let i = 0; i < 30; i++) await r2Backend.put(`f${i}.pdf`, bytes());
    const list = await r2Backend.list();
    expect(list.length).toBe(25);
  });
});

describe("backend selection", () => {
  it("uses R2 when all R2_* vars are set", () => {
    expect(r2Configured()).toBe(true);
    expect(backend()).toBe(r2Backend);
  });

  it("falls back to memory when an R2 var is missing", () => {
    delete process.env.R2_BUCKET;
    expect(r2Configured()).toBe(false);
    expect(backend()).not.toBe(r2Backend);
  });

  it("accepts R2_BUCKET_NAME as an alias for R2_BUCKET", () => {
    delete process.env.R2_BUCKET;
    process.env.R2_BUCKET_NAME = "vellum";
    expect(r2Configured()).toBe(true);
    expect(backend()).toBe(r2Backend);
    delete process.env.R2_BUCKET_NAME;
  });
});
