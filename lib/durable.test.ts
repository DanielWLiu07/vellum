import { beforeEach, describe, expect, it, vi } from "vitest";

const persist = vi.hoisted(() => ({ loadSnapshot: vi.fn(), saveSnapshot: vi.fn() }));
vi.mock("./persist", () => persist);

import { __resetDurable, ensureReady, isHydrated, persistMap, registerHydrator } from "./durable";

beforeEach(() => {
  __resetDurable();
  vi.clearAllMocks();
  persist.loadSnapshot.mockResolvedValue(undefined);
});

describe("durable persistence", () => {
  it("isHydrated flips only after ensureReady", async () => {
    expect(isHydrated()).toBe(false);
    await ensureReady();
    expect(isHydrated()).toBe(true);
  });

  it("hydrates a map from its snapshot on ensureReady", async () => {
    const map = new Map<string, number>();
    persist.loadSnapshot.mockResolvedValue({ a: 1, b: 2 });
    persistMap("nums", map);
    await ensureReady();
    expect([...map.entries()]).toEqual([["a", 1], ["b", 2]]);
  });

  it("does NOT persist before hydration (so a cold write can't clobber the snapshot)", () => {
    const map = new Map<string, number>();
    const { persist: doPersist } = persistMap("nums", map);
    map.set("x", 9);
    doPersist();
    expect(persist.saveSnapshot).not.toHaveBeenCalled();
  });

  it("persists the full map after hydration", async () => {
    const map = new Map<string, number>();
    persist.loadSnapshot.mockResolvedValue({ a: 1 });
    const { persist: doPersist } = persistMap("nums", map);
    await ensureReady();
    map.set("b", 2);
    doPersist();
    expect(persist.saveSnapshot).toHaveBeenCalledWith("nums", { a: 1, b: 2 });
  });

  it("does NOT mark ready when a load FAILS (so persist stays gated, no clobber), and retries", async () => {
    const map = new Map<string, number>();
    persistMap("nums", map);
    persist.loadSnapshot.mockRejectedValueOnce(new Error("kv timeout"));
    await ensureReady();
    expect(isHydrated()).toBe(false); // a read failure must not enable persistence
    // Next call retries; now the load succeeds.
    persist.loadSnapshot.mockResolvedValue({ a: 1 });
    await ensureReady();
    expect(isHydrated()).toBe(true);
    expect([...map.entries()]).toEqual([["a", 1]]);
  });

  it("concurrent ensureReady callers all await the same completed hydration", async () => {
    const map = new Map<string, number>();
    let resolveLoad!: (v: Record<string, number>) => void;
    persist.loadSnapshot.mockReturnValue(new Promise((r) => { resolveLoad = r; }));
    persistMap("nums", map);
    const a = ensureReady();
    const b = ensureReady();
    // Neither resolves until the load does, and isHydrated is false meanwhile.
    expect(isHydrated()).toBe(false);
    resolveLoad({ x: 9 });
    await Promise.all([a, b]);
    expect(isHydrated()).toBe(true);
    expect(map.get("x")).toBe(9);
  });

  it("runs every registered hydrator once", async () => {
    const h1 = vi.fn().mockResolvedValue(undefined);
    const h2 = vi.fn().mockResolvedValue(undefined);
    registerHydrator(h1);
    registerHydrator(h2);
    await ensureReady();
    await ensureReady(); // idempotent
    expect(h1).toHaveBeenCalledTimes(1);
    expect(h2).toHaveBeenCalledTimes(1);
  });
});
