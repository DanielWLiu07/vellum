/**
 * Cloudflare R2 storage backend.
 *
 * R2 speaks the S3 API, so the object logic lives in ./s3-backend; this file
 * only supplies the R2-flavored S3 client (custom endpoint, region "auto",
 * path-style addressing). Enabled when the R2_* env vars are set (see
 * ./index). For Amazon S3 proper, see ./s3.
 */

import { S3Client } from "@aws-sdk/client-s3";

import { makeS3Backend, makeS3BlobStore, makeS3Kv } from "./s3-backend";

let client: S3Client | null = null;
function r2Client(): S3Client {
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
const r2Bucket = () => process.env.R2_BUCKET ?? process.env.R2_BUCKET_NAME ?? "";

export const r2Backend = makeS3Backend(r2Client, r2Bucket);

export const r2Kv = makeS3Kv(r2Client, r2Bucket);

export const r2ImageStore = makeS3BlobStore(r2Client, r2Bucket, "images/");
