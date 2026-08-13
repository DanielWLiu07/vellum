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

import { ensureReady } from "@/lib/bootstrap";
import { localDocId } from "@/lib/local-source";
import { fetchAllowedSource } from "@/lib/source-guard";
import { getDoc, getDocBytes } from "@/lib/store";
import { limitStream } from "@/lib/stream-limit";
import { verifyToken } from "@/lib/token";

/** A one-chunk stream, so stored bytes take the same capped path as a fetch. */
function streamOf(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

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

  // Our own document: read it, don't fetch it. A server-side fetch carries no
  // cookies, so asking ourselves over HTTP means failing our own session gate.
  // The verified token IS the authority here — /api/share checked canView
  // before minting it — so going to the store directly is both correct and a
  // hop cheaper. See lib/local-source.
  const localId = localDocId(src, req.nextUrl.origin);
  let effectiveSrc = src;
  if (localId) {
    await ensureReady();
    const doc = await getDoc(localId);
    if (!doc) {
      return NextResponse.json({ error: "source_error", status: 404 }, { status: 502 });
    }
    if (doc.bundled && doc.publicPath) {
      // A sample has no stored bytes — it ships in /public. Point at the file
      // itself rather than the API route that would redirect to it, so the
      // fetch below never has to bounce through the session gate.
      effectiveSrc = new URL(doc.publicPath, req.nextUrl.origin).toString();
    } else {
      const bytes = await getDocBytes(localId);
      if (!bytes) {
        return NextResponse.json({ error: "source_error", status: 404 }, { status: 502 });
      }
      return new NextResponse(limitStream(streamOf(bytes), MAX_BYTES), {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Cache-Control": "no-store, max-age=0",
          "X-Content-Type-Options": "nosniff",
          "Content-Disposition": "inline",
        },
      });
    }
  }

  // SSRF guard (defense-in-depth behind the HMAC): refuse non-http(s) and
  // private/internal hosts unless the source is the service's own origin. The
  // guard re-runs on every redirect hop — see fetchAllowedSource.
  const guarded = await fetchAllowedSource(effectiveSrc, req.nextUrl.host);
  if (!guarded.ok) {
    return NextResponse.json(
      { error: guarded.error },
      { status: guarded.error === "blocked_source" ? 403 : 502 },
    );
  }
  const upstream = guarded.response;
  if (!upstream.ok || !upstream.body) {
    return NextResponse.json({ error: "source_error", status: upstream.status }, { status: 502 });
  }

  // Cheap early reject on the declared size; limitStream is what actually
  // enforces the ceiling, since content-length is absent on a chunked
  // response and unverified on any other.
  const declaredLength = Number(upstream.headers.get("content-length") ?? "0");
  if (declaredLength > MAX_BYTES) {
    return NextResponse.json({ error: "source_too_large" }, { status: 413 });
  }

  // Stream through unchanged; force a PDF content-type and no-store caching.
  return new NextResponse(limitStream(upstream.body, MAX_BYTES), {
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
