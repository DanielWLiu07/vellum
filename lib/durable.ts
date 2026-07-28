/**
 * Hydration registry. Each durable store registers a hydrator (loads its
 * snapshot into its in-memory map). ensureReady() runs them all exactly once
 * per process, before any request touches the (synchronous) store accessors.
 *
 * lib/bootstrap imports every store so their hydrators are registered before
 * ensureReady() runs; routes call ensureReady() from there.
 */

import { loadSnapshot, saveSnapshot } from "./persist";

type Hydrator = () => Promise<void>;

const g = globalThis as unknown as {
  __durHydrators?: Hydrator[];
  __durHydrated?: boolean;
  __durHydration?: Promise<void> | null;
};
g.__durHydrators ??= [];

export function registerHydrator(h: Hydrator): void {
  g.__durHydrators!.push(h);
}

export async function ensureReady(): Promise<void> {
  if (g.__durHydrated) return;
  // Single shared hydration promise: concurrent callers await the SAME load and
  // none proceeds until it finishes (a second caller must not run on a
  // still-empty map). `__durHydrated` flips true only AFTER every hydrator
  // succeeds - if any load FAILS, we don't mark ready (so persist stays gated
  // off, no clobber) and let the next call retry.
  if (!g.__durHydration) {
    g.__durHydration = (async () => {
      const results = await Promise.allSettled(g.__durHydrators!.map((h) => h()));
      if (results.every((r) => r.status === "fulfilled")) {
        g.__durHydrated = true;
      } else {
        g.__durHydration = null; // a load failed; allow a retry, keep persist gated
      }
    })();
  }
  await g.__durHydration;
}

/**
 * Whether hydration has completed. Persist calls are gated on this: a write
 * that lands before hydration must NOT snapshot the (still-empty) map, or it
 * would clobber the saved state. Routes call ensureReady() before touching a
 * store, so in practice this is true by the time anything mutates.
 */
export function isHydrated(): boolean {
  return Boolean(g.__durHydrated);
}

/**
 * Wire durable persistence into a `Map<string, V>` store: registers a hydrator
 * that fills the map from the snapshot, and returns a persist() to call after
 * each mutation. Values must be JSON-serializable.
 */
export function persistMap<V>(key: string, map: Map<string, V>): { persist: () => void } {
  registerHydrator(async () => {
    const snap = await loadSnapshot<Record<string, V>>(key);
    if (snap) for (const [k, v] of Object.entries(snap)) map.set(k, v);
  });
  return {
    persist: () => {
      if (isHydrated()) saveSnapshot(key, Object.fromEntries(map));
    },
  };
}

/** Test-only: forget hydration + registered hydrators. */
export function __resetDurable(): void {
  g.__durHydrated = false;
  g.__durHydration = null;
  g.__durHydrators = [];
}
