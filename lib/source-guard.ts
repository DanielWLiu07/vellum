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

/** True when `h` is a dotted-quad literal inside a non-routable IPv4 range. */
function isPrivateIpv4(h: string): boolean {
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (a === 0 || a === 127) return true; // this-host / loopback
  if (a === 10) return true; // private
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT (100.64/10) - Tailscale et al
  if (a === 169 && b === 254) return true; // link-local + cloud metadata (169.254.169.254)
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  return false;
}

/**
 * Unpack an IPv4-mapped IPv6 literal to its dotted quad, in either spelling.
 * `new URL` normalizes the readable form (::ffff:127.0.0.1) to hex
 * (::ffff:7f00:1), so a check that only knows the readable one never fires on
 * a real request.
 */
function mappedIpv4(h: string): string | null {
  const dotted = h.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (dotted) return dotted[1]!;
  const hex = h.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (!hex) return null;
  const hi = parseInt(hex[1]!, 16);
  const lo = parseInt(hex[2]!, 16);
  return `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
}

/** True for loopback, private, link-local, and other non-routable hosts. */
export function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, ""); // strip IPv6 brackets
  if (h === "localhost" || h === "0.0.0.0") return true;
  // `.localhost` is reserved (RFC 6761) and resolvers point it at loopback, so
  // `anything.localhost` is a loopback address wearing a routable-looking name.
  if (h.endsWith(".local") || h.endsWith(".internal") || h.endsWith(".localhost")) {
    return true;
  }

  if (isPrivateIpv4(h)) return true;

  // An IPv4-mapped IPv6 literal reaches the same host as its dotted quad, so
  // it has to be unpacked or the mapping is a clean path around every rule
  // above.
  const mapped = mappedIpv4(h);
  if (mapped) return isPrivateIpv4(mapped);

  // A dotted quad that got this far is routable; don't let it fall into the
  // IPv6 prefix checks below.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return false;

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

/** Statuses `fetch` would otherwise follow on our behalf, unchecked. */
const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);

/**
 * Hard cap on redirect hops. Browsers allow 20; a document source has no
 * legitimate need for a long chain, and every hop is another host to validate.
 */
const MAX_REDIRECTS = 5;

export type GuardedFetchError = "blocked_source" | "too_many_redirects" | "source_unreachable";

export type GuardedFetchResult =
  | { ok: true; response: Response }
  | { ok: false; error: GuardedFetchError };

/**
 * Fetch `src`, re-running the guard on every redirect hop.
 *
 * `fetch(src, { redirect: "follow" })` checks nothing after the first URL, so a
 * source on a routable host that 302s to 169.254.169.254 walks straight past
 * isAllowedSource. That is exactly the attack the guard exists to stop: anyone
 * who can set `src` can also control what it redirects to, so validating only
 * the first URL leaves the guard doing no work at all. Walking the chain by
 * hand is what makes the check bind.
 *
 * `fetchImpl` is injectable so the hop logic is testable without a network.
 */
export async function fetchAllowedSource(
  src: string,
  requestHost: string,
  fetchImpl: typeof fetch = fetch,
): Promise<GuardedFetchResult> {
  let url = src;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!isAllowedSource(url, requestHost)) return { ok: false, error: "blocked_source" };

    let res: Response;
    try {
      res = await fetchImpl(url, { redirect: "manual", cache: "no-store" });
    } catch {
      return { ok: false, error: "source_unreachable" };
    }
    if (!REDIRECT_STATUS.has(res.status)) return { ok: true, response: res };

    const location = res.headers.get("location");
    // Nothing reads a redirect's body; release the socket before the next hop.
    void res.body?.cancel().catch(() => {});
    if (!location) return { ok: false, error: "source_unreachable" };
    try {
      // Resolve against the current URL so a relative Location works.
      url = new URL(location, url).toString();
    } catch {
      return { ok: false, error: "source_unreachable" };
    }
  }

  return { ok: false, error: "too_many_redirects" };
}
