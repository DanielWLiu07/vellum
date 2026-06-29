/**
 * SSRF guard for the proxy's source URL.
 *
 * The capability token is HMAC-signed, so only a holder of the shared secret can
 * set `src` - that's the primary control. This is defense-in-depth: if the
 * secret ever leaks, an attacker could mint a token pointing `src` at an
 * internal address (cloud metadata, a private service) and use the proxy as an
 * SSRF pivot. So we additionally refuse non-http(s) schemes and private /
 * loopback / link-local hosts - except the service's own origin, which the live
 * demo legitimately fetches (its sample doc is served same-origin).
 */

/** True for loopback, private, link-local, and other non-routable hosts. */
export function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, ""); // strip IPv6 brackets
  if (h === "localhost" || h === "0.0.0.0" || h.endsWith(".local") || h.endsWith(".internal")) {
    return true;
  }

  // IPv4 literal ranges.
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a === 0 || a === 127) return true; // this-host / loopback
    if (a === 10) return true; // private
    if (a === 169 && b === 254) return true; // link-local + cloud metadata (169.254.169.254)
    if (a === 172 && b >= 16 && b <= 31) return true; // private
    if (a === 192 && b === 168) return true; // private
    return false;
  }

  // IPv6 loopback / link-local / unique-local.
  if (h === "::1") return true;
  if (h.startsWith("fe80:")) return true; // link-local
  if (h.startsWith("fc") || h.startsWith("fd")) return true; // unique-local (fc00::/7)
  return false;
}

/**
 * Whether the proxy may fetch `src`. Allows any http(s) URL on a routable host,
 * plus same-origin URLs unconditionally (the demo serves its sample doc from the
 * service's own origin, which in dev is localhost).
 */
export function isAllowedSource(src: string, requestHost: string): boolean {
  let url: URL;
  try {
    url = new URL(src);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  if (url.host === requestHost) return true; // same-origin (e.g. the live demo)
  return !isPrivateHost(url.hostname);
}
