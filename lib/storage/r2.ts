/**
 * Cloudflare R2 storage backend (S3-compatible API via the AWS S3 SDK).
 *
 * Durable object storage for dashboard uploads. Enabled when the R2_* env vars
 * are set (see lib/storage/index.ts). Each upload is one object under the
 * `uploads/` prefix; the original filename + upload time ride along as S3 user
 * metadata. The same code works against AWS S3 if you ever switch endpoints.
 */

import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

import { normalizeVisibility } from "../visibility";
import {
  DEFAULT_SCOPE,
  MAX_UPLOADS,
  cleanName,
  newUploadId,
  type StorageBackend,
  type UploadMeta,
} from "./types";

const PREFIX = "uploads/";
const keyFor = (id: string) => `${PREFIX}${id}`;
const idFromKey = (key: string) => key.slice(PREFIX.length);

let client: S3Client | null = null;
function s3(): S3Client {
  if (!client) {
    client = new S3Client({
      region: "auto",
      endpoint: process.env.R2_ENDPOINT,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID ?? "",
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? "",
      },
      forcePathStyle: true,
    });
  }
  return client;
}
// Accept R2_BUCKET_NAME too - some Cloudflare/Vercel provisioning sets that
// name, and reading only R2_BUCKET silently disables R2 in prod.
const bucket = () => process.env.R2_BUCKET ?? process.env.R2_BUCKET_NAME ?? "";

function isMissing(err: unknown): boolean {
  const name = (err as { name?: string })?.name;
  const code = (err as { Code?: string })?.Code;
  return name === "NotFound" || name === "NoSuchKey" || code === "NoSuchKey";
}

export const r2Backend: StorageBackend = {
  async list() {
    const res = await s3().send(
      new ListObjectsV2Command({ Bucket: bucket(), Prefix: PREFIX, MaxKeys: MAX_UPLOADS + 50 }),
    );
    const objects = res.Contents ?? [];
    const metas = await Promise.all(
      objects.map(async (o) => {
        const id = idFromKey(o.Key ?? "");
        if (!id) return null;
        const m = await r2Backend.head(id);
        return m;
      }),
    );
    return metas.filter((m): m is UploadMeta => !!m).sort((a, b) => b.uploadedAt - a.uploadedAt);
  },

  async head(id) {
    try {
      const res = await s3().send(new HeadObjectCommand({ Bucket: bucket(), Key: keyFor(id) }));
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
      const res = await s3().send(new GetObjectCommand({ Bucket: bucket(), Key: keyFor(id) }));
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
    await s3().send(
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
    await evictBeyondCap();
    return meta;
  },

  async remove(id) {
    const exists = await r2Backend.head(id);
    if (!exists) return false;
    await s3().send(new DeleteObjectCommand({ Bucket: bucket(), Key: keyFor(id) }));
    return true;
  },
};

/** Delete the oldest uploads beyond MAX_UPLOADS (ordered by LastModified). */
async function evictBeyondCap(): Promise<void> {
  const res = await s3().send(
    new ListObjectsV2Command({ Bucket: bucket(), Prefix: PREFIX, MaxKeys: 1000 }),
  );
  const objects = (res.Contents ?? [])
    .filter((o) => o.Key)
    .sort((a, b) => (a.LastModified?.getTime() ?? 0) - (b.LastModified?.getTime() ?? 0));
  const excess = objects.length - MAX_UPLOADS;
  for (let i = 0; i < excess; i++) {
    await s3().send(new DeleteObjectCommand({ Bucket: bucket(), Key: objects[i].Key! }));
  }
}
