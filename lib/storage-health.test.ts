// Whether an upload survives.
//
// The memory fallback is the right default for a keyless local run, but it is
// indistinguishable from a working system until a file goes missing: uploads
// last only while the instance stays warm and are invisible to other instances
// meanwhile. Every other store snapshots itself; blobs had no signal at all.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { storageBackendName, storageHealth } from "./storage";

const R2 = {
  R2_ENDPOINT: "https://acct.r2.cloudflarestorage.com",
  R2_BUCKET: "vitals",
  R2_ACCESS_KEY_ID: "key",
  R2_SECRET_ACCESS_KEY: "secret",
};
const S3 = {
  S3_BUCKET: "vitals",
  S3_REGION: "us-east-1",
  S3_ACCESS_KEY_ID: "key",
  S3_SECRET_ACCESS_KEY: "secret",
};

function clearAll() {
  for (const k of [...Object.keys(R2), ...Object.keys(S3)]) vi.stubEnv(k, "");
}

beforeEach(clearAll);
afterEach(() => vi.unstubAllEnvs());

describe("storageHealth", () => {
  it("reports NOT durable with no object store configured", () => {
    expect(storageHealth()).toEqual({ backend: "memory", durable: false });
  });

  it("reports durable on R2", () => {
    for (const [k, v] of Object.entries(R2)) vi.stubEnv(k, v);
    expect(storageHealth()).toEqual({ backend: "r2", durable: true });
  });

  it("reports durable on S3", () => {
    for (const [k, v] of Object.entries(S3)) vi.stubEnv(k, v);
    expect(storageHealth()).toEqual({ backend: "s3", durable: true });
  });

  it("prefers S3 when both are set, matching backend()", () => {
    for (const [k, v] of Object.entries({ ...R2, ...S3 })) vi.stubEnv(k, v);
    expect(storageBackendName()).toBe("s3");
  });

  // Half-configured is the dangerous case: it looks configured to a human
  // reading the env list, and falls back to memory in fact.
  it("treats a partially configured R2 as not durable", () => {
    vi.stubEnv("R2_ENDPOINT", R2.R2_ENDPOINT);
    vi.stubEnv("R2_BUCKET", R2.R2_BUCKET);
    // credentials missing
    expect(storageHealth()).toEqual({ backend: "memory", durable: false });
  });

  it("treats an empty-string credential as absent, not as configured", () => {
    for (const [k, v] of Object.entries(R2)) vi.stubEnv(k, v);
    vi.stubEnv("R2_SECRET_ACCESS_KEY", "");
    expect(storageHealth().durable).toBe(false);
  });
});
