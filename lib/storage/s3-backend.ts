/**
 * Shared S3-compatible storage backend.
 *
 * The put/head/get/list/remove/evict logic is identical whether the bucket is
 * Cloudflare R2 or Amazon S3 (both speak the S3 API). Only the client config
 * and bucket name differ, so those are injected. r2.ts and s3.ts each build a
 * client + bucket and hand them to makeS3Backend.
 */

import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  type S3Client,
} from "@aws-sdk/client-s3";

import { normalizeVisibility } from "../visibility";
import {
  DEFAULT_SCOPE,
  MAX_UPLOADS,
  cleanName,
  newUploadId,
  type BlobStore,
  type StorageBackend,
  type UploadMeta,
} from "./types";

const PREFIX = "uploads/";
const keyFor = (id: string) => `${PREFIX}${id}`;
const idFromKey = (key: string) => key.slice(PREFIX.length);

function isMissing(err: unknown): boolean {
  const name = (err as { name?: string })?.name;
  const code = (err as { Code?: string })?.Code;
  return name === "NotFound" || name === "NoSuchKey" || code === "NoSuchKey";
}

/**
 * Build a StorageBackend over any S3-compatible bucket.
 *
 * @param client  lazily returns the configured S3Client (built once, reused)
 * @param bucket  returns the bucket name
 */
/** A tiny stable-key JSON store over the same bucket (for durable app state). */
export interface StateKv {
  get(key: string): Promise<Uint8Array | undefined>;
  put(key: string, bytes: Uint8Array): Promise<void>;
}

export function makeS3Kv(client: () => S3Client, bucket: () => string): StateKv {
  const keyFor = (k: string) => `state/${k}.json`;
  return {
    async get(k) {
      try {
        const res = await client().send(new GetObjectCommand({ Bucket: bucket(), Key: keyFor(k) }));
        if (!res.Body) return undefined;
        const body = res.Body as { transformToByteArray: () => Promise<Uint8Array> };
        return await body.transformToByteArray();
      } catch (err) {
        if (isMissing(err)) return undefined;
        throw err;
      }
    },
    async put(k, bytes) {
      await client().send(
        new PutObjectCommand({ Bucket: bucket(), Key: keyFor(k), Body: bytes, ContentType: "application/json" }),
      );
    },
  };
}

/**
 * Build a durable BlobStore over an S3-compatible bucket under `prefix`. Bytes
 * are stored as the object body; the content-type round-trips via the object's
 * ContentType. No eviction: blobs are referenced by id (e.g. a deck's card
 * image), so dropping an old one would break a live reference.
 */
export function makeS3BlobStore(client: () => S3Client, bucket: () => string, prefix: string): BlobStore {
  const keyFor = (id: string) => `${prefix}${id}`;
  return {
    async get(id) {
      try {
        const res = await client().send(new GetObjectCommand({ Bucket: bucket(), Key: keyFor(id) }));
        if (!res.Body) return undefined;
        const body = res.Body as { transformToByteArray: () => Promise<Uint8Array> };
        return { bytes: await body.transformToByteArray(), contentType: res.ContentType ?? "application/octet-stream" };
      } catch (err) {
        if (isMissing(err)) return undefined;
        throw err;
      }
    },
    async put(id, bytes, contentType) {
      await client().send(
        new PutObjectCommand({ Bucket: bucket(), Key: keyFor(id), Body: bytes, ContentType: contentType }),
      );
    },
    async remove(id) {
      try {
        await client().send(new DeleteObjectCommand({ Bucket: bucket(), Key: keyFor(id) }));
        return true;
      } catch (err) {
        if (isMissing(err)) return false;
        throw err;
      }
    },
  };
}

export function makeS3Backend(client: () => S3Client, bucket: () => string): StorageBackend {
  const backend: StorageBackend = {
    async list() {
      const res = await client().send(
        new ListObjectsV2Command({ Bucket: bucket(), Prefix: PREFIX, MaxKeys: MAX_UPLOADS + 50 }),
      );
      const objects = res.Contents ?? [];
      const metas = await Promise.all(
        objects.map(async (o) => {
          const id = idFromKey(o.Key ?? "");
          if (!id) return null;
          return backend.head(id);
        }),
      );
      return metas.filter((m): m is UploadMeta => !!m).sort((a, b) => b.uploadedAt - a.uploadedAt);
    },

    async head(id) {
      try {
        const res = await client().send(new HeadObjectCommand({ Bucket: bucket(), Key: keyFor(id) }));
        const md = res.Metadata ?? {};
        return {
          id,
          name: md.name ? decodeURIComponent(md.name) : "document.pdf",
          sizeBytes: res.ContentLength ?? 0,
          uploadedAt: md.uploadedat ? Number(md.uploadedat) : (res.LastModified?.getTime() ?? 0),
          contentType: res.ContentType ?? "application/pdf",
          visibility: normalizeVisibility(md.visibility),
          chapter: md.chapter ? decodeURIComponent(md.chapter) : "",
          owner: md.owner ? decodeURIComponent(md.owner) : "system",
        };
      } catch (err) {
        if (isMissing(err)) return undefined;
        throw err;
      }
    },

    async getBytes(id) {
      try {
        const res = await client().send(new GetObjectCommand({ Bucket: bucket(), Key: keyFor(id) }));
        if (!res.Body) return undefined;
        const body = res.Body as { transformToByteArray: () => Promise<Uint8Array> };
        return await body.transformToByteArray();
      } catch (err) {
        if (isMissing(err)) return undefined;
        throw err;
      }
    },

    async put(name, bytes, contentType = "application/pdf", scope = DEFAULT_SCOPE) {
      const id = newUploadId();
      const meta: UploadMeta = {
        id,
        name: cleanName(name),
        sizeBytes: bytes.byteLength,
        uploadedAt: Date.now(),
        contentType,
        visibility: scope.visibility,
        chapter: scope.chapter,
        owner: scope.owner,
      };
      await client().send(
        new PutObjectCommand({
          Bucket: bucket(),
          Key: keyFor(id),
          Body: bytes,
          ContentType: contentType,
          Metadata: {
            name: encodeURIComponent(meta.name),
            uploadedat: String(meta.uploadedAt),
            visibility: meta.visibility,
            chapter: encodeURIComponent(meta.chapter),
            owner: encodeURIComponent(meta.owner),
          },
        }),
      );
      await evictBeyondCap(client, bucket);
      return meta;
    },

    async remove(id) {
      const exists = await backend.head(id);
      if (!exists) return false;
      await client().send(new DeleteObjectCommand({ Bucket: bucket(), Key: keyFor(id) }));
      return true;
    },
  };
  return backend;
}

/** Delete the oldest uploads beyond MAX_UPLOADS (ordered by LastModified). */
async function evictBeyondCap(client: () => S3Client, bucket: () => string): Promise<void> {
  const res = await client().send(
    new ListObjectsV2Command({ Bucket: bucket(), Prefix: PREFIX, MaxKeys: 1000 }),
  );
  const objects = (res.Contents ?? [])
    .filter((o) => o.Key)
    .sort((a, b) => (a.LastModified?.getTime() ?? 0) - (b.LastModified?.getTime() ?? 0));
  const excess = objects.length - MAX_UPLOADS;
  for (let i = 0; i < excess; i++) {
    await client().send(new DeleteObjectCommand({ Bucket: bucket(), Key: objects[i].Key! }));
  }
}
