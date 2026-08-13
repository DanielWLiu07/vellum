/**
 * Byte ceiling for a streamed response body.
 *
 * The proxy can't take `content-length` as the limit: a chunked upstream omits
 * the header entirely, and a hostile one is free to understate it. Counting
 * bytes as they pass is the only enforcement that actually holds, so the
 * declared length stays a cheap early reject and this is the real gate.
 */

/**
 * Wrap `body` so it errors the moment more than `maxBytes` have passed through.
 *
 * Erroring rather than truncating is deliberate: a silently short PDF looks
 * like a corrupt document, which sends the reader hunting for a bug in the
 * file instead of finding the limit that produced it.
 */
export function limitStream(
  body: ReadableStream<Uint8Array>,
  maxBytes: number,
): ReadableStream<Uint8Array> {
  let seen = 0;
  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        seen += chunk.byteLength;
        if (seen > maxBytes) {
          controller.error(new Error(`source exceeded ${maxBytes} bytes`));
          return;
        }
        controller.enqueue(chunk);
      },
    }),
  );
}
