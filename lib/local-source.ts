/**
 * Recognising a capability token's `src` as one of our own documents.
 *
 * /api/share mints tokens with `src = ${origin}/api/doc/<id>`, and /api/proxy
 * used to fetch that back over HTTP. A server-side fetch carries no cookies, so
 * the moment the app grew a session gate the viewer started asking itself for a
 * document and being turned away — every document failed with "the document
 * source couldn't be reached".
 *
 * Exempting the path from the gate would be the wrong fix: it would open
 * /api/doc to anyone, which is the thing the gate exists to prevent. The right
 * one is to stop making the request. By the time the proxy has a verified
 * capability token it already holds the authority the fetch was going to prove
 * — /api/share checked canView before minting it — so it can read the bytes
 * straight from the store. One less hop, and no self-authentication puzzle.
 */

/**
 * The document id when `src` is this service's own /api/doc/<id>, else null.
 *
 * Matching is exact: same origin, and a path of precisely /api/doc/<id> with
 * nothing after it. A prefix match would let /api/doc/<id>/preview — or any
 * future sub-route — resolve to the wrong bytes.
 */
export function localDocId(src: string, requestOrigin: string): string | null {
  let url: URL;
  let origin: URL;
  try {
    url = new URL(src);
    origin = new URL(requestOrigin);
  } catch {
    return null;
  }
  if (url.host !== origin.host || url.protocol !== origin.protocol) return null;

  const match = /^\/api\/doc\/([^/]+)$/.exec(url.pathname);
  if (!match) return null;
  return decodeURIComponent(match[1]!);
}
