/**
 * Durable snapshot persistence for the app's in-memory stores.
 *
 * Where snapshots go, in priority order:
 *   1. object storage (S3 / R2) when configured  - durable in production
 *   2. the local filesystem (.data/<key>.json)   - durable across `next dev`
 *      restarts in local development
 *   3. nowhere (in-memory only)                   - tests / read-only FS
 *
 * A store calls saveSnapshot() after each mutation (debounced + coalesced, so
 * a burst of writes collapses into one) and loadSnapshot() once at hydration.
 * Snapshots are small JSON documents; binary uploads are NOT persisted here -
 * they belong in the object-storage upload backend.
 */

import { promises as fs } from "node:fs";
import path from "node:path";

import { objectKv } from "./storage";

const DATA_DIR = path.join(process.cwd(), ".data");
const enc = new TextEncoder();
const dec = new TextDecoder();

// Under Vitest we keep everything in-memory so unit tests never touch the disk
// or a bucket (no .data pollution, no network).
const inert = () => process.env.VITEST === "true" || process.env.NODE_ENV === "test";

async function fsLoad(key: string): Promise<Uint8Array | undefined> {
  try {
    return new Uint8Array(await fs.readFile(path.join(DATA_DIR, `${key}.json`)));
  } catch (e) {
    // A genuinely-absent file means "no snapshot yet" -> undefined. ANY other
    // error (permissions, I/O) must propagate so the caller does NOT treat a
    // read failure as an empty store (which would clobber good data on save).
    if ((e as NodeJS.ErrnoException)?.code === "ENOENT") return undefined;
    throw e;
  }
}

async function fsSave(key: string, bytes: Uint8Array): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(path.join(DATA_DIR, `${key}.json`), bytes);
}

export async function loadSnapshot<T>(key: string): Promise<T | undefined> {
  if (inert()) return undefined;
  // A read/parse ERROR must THROW (so the caller won't treat a transient
  // failure as an empty store and clobber good data). Only a genuinely-absent
  // snapshot returns undefined - the KV/FS layers map "not found" to undefined
  // and re-throw everything else.
  const kv = objectKv();
  const bytes = kv ? await kv.get(key) : await fsLoad(key);
  if (!bytes || bytes.byteLength === 0) return undefined;
  return JSON.parse(dec.decode(bytes)) as T; // corrupt snapshot -> throws, not clobber
}

// Debounced, coalesced, fire-and-forget writes per key.
const pending = new Map<string, unknown>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();

export function saveSnapshot(key: string, value: unknown): void {
  if (inert()) return;
  pending.set(key, value);
  if (timers.has(key)) return;
  const timer = setTimeout(() => {
    timers.delete(key);
    const v = pending.get(key);
    pending.delete(key);
    const bytes = enc.encode(JSON.stringify(v));
    const kv = objectKv();
    void (kv ? kv.put(key, bytes) : fsSave(key, bytes)).catch(() => {});
  }, 250);
  // Don't hold the process open just for a pending snapshot write.
  (timer as { unref?: () => void }).unref?.();
  timers.set(key, timer);
}
