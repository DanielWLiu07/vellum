/**
 * Client-side, UNVERIFIED claim decoding.
 *
 * The browser can't (and shouldn't) verify the HMAC — that's the proxy's job,
 * and the proxy refuses to return bytes for an invalid token. But the viewer UI
 * needs the watermark text and permission hints to render, so it reads them from
 * the token payload without trusting them for security. Hiding the download
 * button is cosmetic; the actual enforcement is that no endpoint will serve the
 * bytes without a valid signature.
 */

export interface ClientClaims {
  wm: string;
  perms: { download: boolean; print: boolean; copy: boolean };
}

export function decodeClaimsUnsafe(token: string): ClientClaims | null {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    // atob yields a binary (latin1) string; decode it as UTF-8 so watermarks
    // with bullets, accents, or non-ASCII names render correctly.
    const binary = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    const json = new TextDecoder().decode(bytes);
    const raw = JSON.parse(json) as { wm?: unknown; perms?: Record<string, unknown> };
    return {
      wm: typeof raw.wm === "string" ? raw.wm : "",
      perms: {
        download: raw.perms?.download === true,
        print: raw.perms?.print === true,
        copy: raw.perms?.copy === true,
      },
    };
  } catch {
    return null;
  }
}
