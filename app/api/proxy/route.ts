/**
 * Document proxy - the one server endpoint that touches the actual bytes.
 *
 * The browser never learns the real source URL. The client reads the capability
 * token from the URL fragment and POSTs it here; we verify the signature, fetch
 * the document from the token's `src` server-side, and stream it back. The
 * presigned/source URL stays on the server, so it can't be copied out of the
 * network tab and replayed.
 */

import { NextRequest, NextResponse } from "next/server";

import { isAllowedSource } from "@/lib/source-guard";
import { verifyToken } from "@/lib/token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 100 * 1024 * 1024; // 100 MB ceiling - refuse absurd sources.

export async function POST(req: NextRequest) {
  const secret = process.env.VELLUM_TOKEN_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "viewer_not_configured" }, { status: 500 });
  }

  let token: string | undefined;
  try {
    const body = await req.json();
    token = typeof body?.t === "string" ? body.t : undefined;
  } catch {
    /* fall through to missing-token */
  }
  if (!token) {
    return NextResponse.json({ error: "missing_token" }, { status: 400 });
  }

  const result = verifyToken(secret, token);
  if (!result.ok) {
    const status = result.reason === "expired" ? 410 : 401;
    return NextResponse.json({ error: result.reason }, { status });
  }

  const { src } = result.claims;

  // SSRF guard (defense-in-depth behind the HMAC): refuse non-http(s) and
  // private/internal hosts unless the source is the service's own origin.
  if (!isAllowedSource(src, req.nextUrl.host)) {
    return NextResponse.json({ error: "blocked_source" }, { status: 403 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(src, { redirect: "follow", cache: "no-store" });
  } catch {
    return NextResponse.json({ error: "source_unreachable" }, { status: 502 });
  }
  if (!upstream.ok || !upstream.body) {
    return NextResponse.json({ error: "source_error", status: upstream.status }, { status: 502 });
  }

  const declaredLength = Number(upstream.headers.get("content-length") ?? "0");
  if (declaredLength > MAX_BYTES) {
    return NextResponse.json({ error: "source_too_large" }, { status: 413 });
  }

  // Stream through unchanged; force a PDF content-type and no-store caching.
  return new NextResponse(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Cache-Control": "no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
      // The viewer fetches via XHR/fetch; this is belt-and-suspenders.
      "Content-Disposition": "inline",
    },
  });
}
