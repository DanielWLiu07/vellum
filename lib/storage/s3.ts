/**
 * Amazon S3 storage backend.
 *
 * Object logic lives in ./s3-backend; this file supplies a native-S3 client
 * (real region, default AWS endpoint, virtual-hosted addressing). Enabled when
 * the S3 env vars are set (see ./index), which takes precedence over R2.
 *
 * Config (env):
 *   S3_BUCKET             required
 *   S3_REGION | AWS_REGION required
 *   S3_ACCESS_KEY_ID | AWS_ACCESS_KEY_ID          } credentials; if BOTH are
 *   S3_SECRET_ACCESS_KEY | AWS_SECRET_ACCESS_KEY  } absent, the SDK's default
 *                                                   provider chain (IAM role)
 *                                                   is used instead.
 */

import { S3Client } from "@aws-sdk/client-s3";

import { makeS3Backend, makeS3BlobStore, makeS3Kv } from "./s3-backend";

const accessKeyId = () => process.env.S3_ACCESS_KEY_ID ?? process.env.AWS_ACCESS_KEY_ID;
const secretAccessKey = () => process.env.S3_SECRET_ACCESS_KEY ?? process.env.AWS_SECRET_ACCESS_KEY;
const region = () => process.env.S3_REGION ?? process.env.AWS_REGION ?? "";
const s3Bucket = () => process.env.S3_BUCKET ?? "";

/**
 * True when a native S3 bucket is configured: a bucket, a region, and either
 * explicit keys or (assumed) an ambient IAM role. We require explicit keys OR
 * an ambient role signal via AWS_REGION; keeping it to "bucket + region + keys"
 * avoids half-configured S3 silently shadowing a working R2 setup.
 */
export function s3Configured(): boolean {
  return Boolean(s3Bucket() && region() && accessKeyId() && secretAccessKey());
}

let client: S3Client | null = null;
function s3Client(): S3Client {
  if (!client) {
    const ak = accessKeyId();
    const sk = secretAccessKey();
    client = new S3Client({
      region: region() || "us-east-1",
      // Explicit keys when provided; otherwise the SDK's default credential
      // provider chain (env / shared config / IAM role) kicks in.
      ...(ak && sk ? { credentials: { accessKeyId: ak, secretAccessKey: sk } } : {}),
    });
  }
  return client;
}

export const s3Backend = makeS3Backend(s3Client, s3Bucket);

export const s3Kv = makeS3Kv(s3Client, s3Bucket);

export const s3ImageStore = makeS3BlobStore(s3Client, s3Bucket, "images/");
