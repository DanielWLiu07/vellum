import { NextRequest, NextResponse } from "next/server";

import { getDoc } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Serves a stored document's bytes. This is the `src` the viewer's proxy fetches
// (same-origin, so it passes the SSRF guard). Bundled samples redirect to their
// /public path; uploads stream from the in-memory store.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const doc = getDoc(id);
  if (!doc) return NextResponse.json({ error: "not_found" }, { status: 404 });

  if (doc.bundled && doc.publicPath) {
    return NextResponse.redirect(new URL(doc.publicPath, _req.nextUrl.origin));
  }
  if (doc.bytes) {
    return new NextResponse(doc.bytes, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Cache-Control": "no-store, max-age=0",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }
  return NextResponse.json({ error: "not_found" }, { status: 404 });
}
