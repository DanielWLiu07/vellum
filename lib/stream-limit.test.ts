import { describe, expect, it } from "vitest";

import { limitStream } from "./stream-limit";

/** A stream of `count` chunks of `size` bytes each. */
function chunks(count: number, size: number): ReadableStream<Uint8Array> {
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i++ >= count) {
        controller.close();
        return;
      }
      controller.enqueue(new Uint8Array(size).fill(65));
    },
  });
}

async function drain(s: ReadableStream<Uint8Array>): Promise<number> {
  let total = 0;
  const reader = s.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return total;
    total += value.byteLength;
  }
}

describe("limitStream", () => {
  it("passes a body under the ceiling through untouched", async () => {
    expect(await drain(limitStream(chunks(4, 100), 1000))).toBe(400);
  });

  it("passes a body exactly at the ceiling", async () => {
    expect(await drain(limitStream(chunks(4, 250), 1000))).toBe(1000);
  });

  it("errors once the ceiling is crossed", async () => {
    await expect(drain(limitStream(chunks(10, 250), 1000))).rejects.toThrow(/exceeded 1000 bytes/);
  });

  // The case content-length can't catch: a chunked upstream declares no length
  // at all, so the only thing standing between the proxy and an unbounded body
  // is this counter.
  it("stops an unbounded stream that never declares a length", async () => {
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(1024));
      },
    });
    await expect(drain(limitStream(endless, 8 * 1024))).rejects.toThrow(/exceeded/);
  });

  it("does not read the whole source before refusing", async () => {
    let produced = 0;
    const counted = new ReadableStream<Uint8Array>({
      pull(controller) {
        produced += 1;
        controller.enqueue(new Uint8Array(500));
      },
    });
    await expect(drain(limitStream(counted, 1000))).rejects.toThrow();
    // A handful of chunks of read-ahead is fine; consuming thousands is not.
    expect(produced).toBeLessThan(20);
  });
});
