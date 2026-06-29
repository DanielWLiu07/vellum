import { NextRequest, NextResponse } from "next/server";

import { deleteDoc, getDoc, getDocBytes } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Serves a stored document's bytes. This is the `src` the viewer's proxy fetches
// (same-origin, so it passes the SSRF guard). Bundled samples redirect to their
// /public path; uploads stream from the in-memory store.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const doc = await getDoc(id);
  if (!doc) return NextResponse.json({ error: "not_found" }, { status: 404 });

  if (doc.bundled && doc.publicPath) {
    return NextResponse.redirect(new URL(doc.publicPath, _req.nextUrl.origin));
  }
  const bytes = await getDocBytes(id);
  if (bytes) {
    return new NextResponse(bytes, {
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

// Deletes an uploaded document (dashboard mode only). Bundled samples are
// immutable, so deleteDoc returns false for them → 404.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (process.env.VELLUM_DEMO_MODE !== "1") {
    return NextResponse.json({ error: "dashboard_disabled" }, { status: 404 });
  }
  const { id } = await params;
  const ok = await deleteDoc(id);
  if (!ok) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
