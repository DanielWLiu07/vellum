// Native S3 backend + the S3/R2/memory selector, against a fake in-memory S3
// (the AWS SDK is mocked). Covers s3Configured across env combinations, the
// selection precedence (S3 > R2 > memory), and the object operations reached
// through the shared factory.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const store = new Map<
    string,
    { Body: Uint8Array; Metadata: Record<string, string>; ContentType?: string; size: number; lastModified: Date }
  >();
  let clock = 0;
  return { store, tick: () => ++clock };
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
    constructor(public config: Record<string, unknown>) {}
    async send(cmd: Cmd) {
      const i = cmd.input as Record<string, string> & { Body?: Uint8Array };
      if (cmd instanceof PutObjectCommand) {
        h.store.set(i.Key, {
          Body: i.Body!,
          Metadata: (i as unknown as { Metadata: Record<string, string> }).Metadata,
          ContentType: (i as unknown as { ContentType?: string }).ContentType,
          size: i.Body!.byteLength,
          lastModified: new Date(h.tick() * 1000),
        });
        return {};
      }
      if (cmd instanceof HeadObjectCommand) {
        const o = h.store.get(i.Key);
        if (!o) throw missing("NotFound");
        return { Metadata: o.Metadata, ContentLength: o.size, LastModified: o.lastModified };
      }
      if (cmd instanceof GetObjectCommand) {
        const o = h.store.get(i.Key);
        if (!o) throw missing("NoSuchKey");
        return { Body: { transformToByteArray: async () => o.Body }, ContentType: o.ContentType };
      }
      if (cmd instanceof ListObjectsV2Command) {
        const Contents = [...h.store.entries()]
          .filter(([k]) => k.startsWith(i.Prefix))
          .map(([Key, o]) => ({ Key, Size: o.size, LastModified: o.lastModified }));
        return { Contents };
      }
      if (cmd instanceof DeleteObjectCommand) {
        h.store.delete(i.Key);
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

import { s3Backend, s3Configured, s3ImageStore } from "./s3";
import { r2Backend, r2ImageStore } from "./r2";
import { memoryBackend } from "./memory";
import { backend, imageStore, objectStoreConfigured, r2Configured } from "./index";

const S3_VARS = ["S3_BUCKET", "S3_REGION", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"];
const AWS_VARS = ["AWS_REGION", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"];
const R2_VARS = ["R2_ENDPOINT", "R2_BUCKET", "R2_BUCKET_NAME", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"];
const ALL = [...S3_VARS, ...AWS_VARS, ...R2_VARS];

function clearAll() {
  for (const v of ALL) delete process.env[v];
}
function setS3() {
  process.env.S3_BUCKET = "vellum-s3";
  process.env.S3_REGION = "us-east-1";
  process.env.S3_ACCESS_KEY_ID = "AKIA_test";
  process.env.S3_SECRET_ACCESS_KEY = "secret";
}
function setR2() {
  process.env.R2_ENDPOINT = "https://acct.r2.cloudflarestorage.com";
  process.env.R2_BUCKET = "vellum";
  process.env.R2_ACCESS_KEY_ID = "key";
  process.env.R2_SECRET_ACCESS_KEY = "secret";
}

const bytes = (n = 4) => new Uint8Array(n).fill(0x25);

beforeEach(() => {
  h.store.clear();
  clearAll();
});
afterEach(clearAll);

describe("s3Configured", () => {
  it("true when bucket + region + key + secret are all set", () => {
    setS3();
    expect(s3Configured()).toBe(true);
  });

  it.each(S3_VARS)("false when %s is missing", (missingVar) => {
    setS3();
    delete process.env[missingVar];
    expect(s3Configured()).toBe(false);
  });

  it("reads the region from AWS_REGION when S3_REGION is unset", () => {
    setS3();
    delete process.env.S3_REGION;
    process.env.AWS_REGION = "eu-west-1";
    expect(s3Configured()).toBe(true);
  });

  it("reads credentials from AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY", () => {
    process.env.S3_BUCKET = "b";
    process.env.S3_REGION = "us-east-1";
    process.env.AWS_ACCESS_KEY_ID = "AKIA";
    process.env.AWS_SECRET_ACCESS_KEY = "sk";
    expect(s3Configured()).toBe(true);
  });

  it("false when nothing is set", () => {
    expect(s3Configured()).toBe(false);
  });
});

describe("selector precedence", () => {
  it("uses S3 when S3 is configured (even alongside R2)", () => {
    setS3();
    setR2();
    expect(s3Configured()).toBe(true);
    expect(r2Configured()).toBe(true);
    expect(objectStoreConfigured()).toBe(true);
    expect(backend()).toBe(s3Backend);
  });

  it("uses R2 when only R2 is configured", () => {
    setR2();
    expect(s3Configured()).toBe(false);
    expect(backend()).toBe(r2Backend);
  });

  it("falls back to memory when neither is configured", () => {
    expect(objectStoreConfigured()).toBe(false);
    expect(backend()).toBe(memoryBackend);
  });

  it("objectStoreConfigured is true for S3-only", () => {
    setS3();
    expect(objectStoreConfigured()).toBe(true);
  });
});

describe("s3Backend object operations (through the factory)", () => {
  beforeEach(setS3);

  it("puts an object and reads back metadata + bytes", async () => {
    const meta = await s3Backend.put("notes (v2).pdf", bytes(10));
    expect(meta.id).toMatch(/^u_/);
    expect(meta.sizeBytes).toBe(10);
    const head = await s3Backend.head(meta.id);
    expect(head?.name).toBe("notes (v2).pdf");
    expect(head?.sizeBytes).toBe(10);
    const raw = await s3Backend.getBytes(meta.id);
    expect(raw?.byteLength).toBe(10);
  });

  it("returns undefined for a missing object", async () => {
    expect(await s3Backend.head("u_none")).toBeUndefined();
    expect(await s3Backend.getBytes("u_none")).toBeUndefined();
  });

  it("lists newest-first", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(1_000_000));
      const a = await s3Backend.put("a.pdf", bytes());
      vi.setSystemTime(new Date(2_000_000));
      const b = await s3Backend.put("b.pdf", bytes());
      const list = await s3Backend.list();
      expect(list.map((m) => m.id)).toEqual([b.id, a.id]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("removes an object and reports existence", async () => {
    const m = await s3Backend.put("x.pdf", bytes());
    expect(await s3Backend.remove(m.id)).toBe(true);
    expect(await s3Backend.head(m.id)).toBeUndefined();
    expect(await s3Backend.remove("u_none")).toBe(false);
  });

  it("evicts the oldest beyond the 25-upload cap", async () => {
    for (let i = 0; i < 30; i++) await s3Backend.put(`f${i}.pdf`, bytes());
    expect((await s3Backend.list()).length).toBe(25);
  });
});

describe("image blob store (durable)", () => {
  it("selects the S3 image store when S3 is configured", () => {
    setS3();
    expect(imageStore()).toBe(s3ImageStore);
  });

  it("selects the R2 image store when only R2 is configured", () => {
    setR2();
    expect(imageStore()).toBe(r2ImageStore);
  });

  it("round-trips bytes + content type through object storage", async () => {
    setS3();
    await s3ImageStore.put("img_1", new Uint8Array([1, 2, 3]), "image/png");
    const got = await s3ImageStore.get("img_1");
    expect(got?.contentType).toBe("image/png");
    expect(Array.from(got?.bytes ?? [])).toEqual([1, 2, 3]);
  });

  it("survives a process restart: bytes persist in the bucket, not memory", async () => {
    setS3();
    await s3ImageStore.put("img_keep", new Uint8Array([9, 9]), "image/jpeg");
    // Simulate a restart: any in-process image map is gone, but the bucket
    // (h.store) is not. A fresh get still finds the bytes.
    const gb = globalThis as unknown as { __vellumImages?: Map<string, unknown> };
    gb.__vellumImages?.clear();
    const got = await s3ImageStore.get("img_keep");
    expect(got?.contentType).toBe("image/jpeg");
    expect(Array.from(got?.bytes ?? [])).toEqual([9, 9]);
  });

  it("does NOT evict referenced blobs (unlike the upload cap)", async () => {
    setS3();
    for (let i = 0; i < 60; i++) await s3ImageStore.put(`img_${i}`, bytes(), "image/png");
    // The very first image is still retrievable - no ring-buffer eviction.
    expect(await s3ImageStore.get("img_0")).toBeDefined();
  });

  it("removes a blob and reports absence", async () => {
    setS3();
    await s3ImageStore.put("img_x", bytes(), "image/png");
    expect(await s3ImageStore.remove("img_x")).toBe(true);
    expect(await s3ImageStore.get("img_x")).toBeUndefined();
  });
});
