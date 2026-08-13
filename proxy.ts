/**
 * The request gate.
 *
 * Vitals has no accounts of its own: a member arrives from HOSA carrying a
 * signed identity token, and everything scoped — chapter resources, rosters,
 * assignments — keys off that identity. Nothing enforced it. getViewer() falls
 * back to the standalone demo profile whenever there is no session, so on a
 * deployment with VELLUM_DEMO_MODE=1 (which the product needs set to function
 * at all) an anonymous visitor arrived holding a working identity on a real
 * chapter. This is what makes the handoff mean something.
 *
 * Only active once VITALS_AUTH_SECRET is configured. Without a secret there is
 * no host app and nobody to authenticate against, so the app stays the
 * standalone local demo it was built to be — the fallback profile is the point
 * there, not a hole.
 *
 * Next 16 renamed middleware to proxy and defaults it to the Node.js runtime,
 * so this verifies the HMAC properly instead of settling for a cookie-presence
 * check that anyone could forge.
 */

import { type NextRequest, NextResponse } from "next/server";

import { SESSION_COOKIE, verifyIdentityToken } from "@/lib/identity-token";

/**
 * Paths that must stay reachable without a session.
 *
 * `/embed` and `/api/proxy` are not unauthenticated — they carry their own
 * capability token (lib/token) and are the surfaces a HOST app embeds, so a
 * session cookie is exactly what they cannot rely on.
 */
const PUBLIC_PATHS = new Set([
  // NOT "/": app/page.tsx redirects it straight to /dashboard, so leaving it
  // public just sends an unauthenticated visitor into /dashboard -> here ->
  // / -> /dashboard, forever. Gating it makes the first hop land on
  // /signed-out, which is terminal.
  "/signed-out", // where an unauthenticated visitor is sent
  "/sample.pdf", // the landing demo's document
  "/pdf.worker.min.mjs", // pdfjs worker the viewer loads, including inside /embed
  "/embed", // framed viewer — capability-token authenticated
  "/api/proxy", // document bytes — capability token in the body
  "/api/demo-token", // gated on VELLUM_DEMO_MODE
  "/api/auth/enter", // the handoff itself: no session yet, that's the point
  "/api/auth/demo", // gated on VELLUM_DEMO_SIGNIN
  "/api/auth/logout", // harmless without a session
  "/api/auth/me", // reports "signed out" rather than failing
]);

export function proxy(req: NextRequest): NextResponse {
  const secret = process.env.VITALS_AUTH_SECRET ?? "";
  // Standalone demo: no host app, nobody to authenticate.
  if (secret.length < 16) return NextResponse.next();

  const { pathname } = req.nextUrl;
  if (PUBLIC_PATHS.has(pathname)) return NextResponse.next();

  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (token && verifyIdentityToken(secret, token).ok) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json(
      { error: "unauthenticated" },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  // A page request: explain, remembering where they were headed so the handoff
  // can land them there once HOSA signs them in.
  const signedOut = new URL("/signed-out", req.nextUrl.origin);
  signedOut.searchParams.set("from", pathname);
  return NextResponse.redirect(signedOut);
}

export const config = {
  // Everything except Next's own static output. Public assets are few and
  // named explicitly in PUBLIC_PATHS rather than waved through by extension,
  // so a future upload route can't be reached by ending a path in ".pdf".
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
