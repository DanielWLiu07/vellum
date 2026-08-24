// How an editor's autosave gets onto the wire.
//
// All three editors here (module, deck, quiz) autosave by PATCHing the WHOLE
// document on every change, and all three set `keepalive: true` so a save
// already in flight survived the page going away.
//
// That flag has a limit the editors did not. The Fetch spec caps the combined
// body of a page's in-flight keepalive requests at 64 KiB, and past it the
// browser does not truncate or downgrade — it rejects the request outright,
// before a byte reaches the network. Measured in Chrome against this app: a
// 60 KB body sends, a 70 KB body throws `TypeError: Failed to fetch`, and the
// identical 70 KB body with keepalive omitted sends fine.
//
// The servers accept far more than 64 KiB. A 500-card deck (MAX_CARDS), a
// 100-question quiz (MAX_QUESTIONS), and seven full written-info blocks
// (BODY_MAX) are all documents the API sanctions and the client could not
// send. Autosave threw, the catch reported "Couldn't save your changes.", and
// it did so again on every subsequent keystroke — the editor got permanently
// stuck, and the larger the document the more certain it was to happen.
//
// So keepalive is conditional now. Under the cap it buys what it always did.
// Over the cap it buys nothing — a rejected request is not a durable one — so
// we drop it and let the save go by the normal path, which has no size limit
// and completes for every navigation short of the tab actually closing.

/**
 * Budget for the keepalive flag, in bytes.
 *
 * The spec's cap is 64 KiB across all of a page's in-flight keepalive
 * requests, not per request, so we sit under it deliberately. An editor aborts
 * its predecessor before starting a save, but an aborted request's bytes are
 * not guaranteed to have left the tally by the time the next one asks.
 */
export const KEEPALIVE_BUDGET_BYTES = 60 * 1024;

/** Byte length of `body` as it will actually be sent (UTF-8, not UTF-16). */
export function bodyBytes(body: string): number {
  return new TextEncoder().encode(body).length;
}

/** Whether this body is small enough to risk the keepalive flag. */
export function keepaliveFits(body: string): boolean {
  return bodyBytes(body) <= KEEPALIVE_BUDGET_BYTES;
}

/**
 * `fetch` init for an editor autosave: JSON PATCH, abortable, and keepalive
 * only when the body fits inside the budget above.
 */
export function autosaveInit(body: string, signal: AbortSignal): RequestInit {
  return {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body,
    signal,
    ...(keepaliveFits(body) ? { keepalive: true } : {}),
  };
}
