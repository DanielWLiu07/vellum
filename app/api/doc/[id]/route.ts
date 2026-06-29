import { NextRequest, NextResponse } from "next/server";

import { recordAudit } from "@/lib/audit";
import { clientIp } from "@/lib/rate-limit";
import { setShare } from "@/lib/resource-share";
import { deleteDoc, getDoc, getDocBytes } from "@/lib/store";
import { DEMO_VIEWER, canView, normalizeVisibility } from "@/lib/visibility";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Serves a stored document's bytes. This is the `src` the viewer's proxy fetches
// (same-origin, so it passes the SSRF guard). Bundled samples redirect to their
// /public path; uploads stream from the in-memory store.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const doc = await getDoc(id);
  if (!doc) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!canView(doc, DEMO_VIEWER)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  if (doc.bundled && doc.publicPath) {
    return NextResponse.redirect(new URL(doc.publicPath, _req.nextUrl.origin));
  }
  const bytes = await getDocBytes(id);
  if (bytes) {
    return new NextResponse(bytes, {
      status: 200,
      headers: {
        "Content-Type": doc.contentType || "application/pdf",
        "Cache-Control": "no-store, max-age=0",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }
  return NextResponse.json({ error: "not_found" }, { status: 404 });
}

// Deletes an uploaded document (dashboard mode only). Bundled samples are
// immutable, so deleteDoc returns false for them and the caller gets a 404.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (process.env.VELLUM_DEMO_MODE !== "1") {
    return NextResponse.json({ error: "dashboard_disabled" }, { status: 404 });
  }
  const { id } = await params;
  const doc = await getDoc(id);
  if (!doc) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!canView(doc, DEMO_VIEWER)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const ok = await deleteDoc(id);
  if (!ok) return NextResponse.json({ error: "not_found" }, { status: 404 });
  recordAudit("document.delete", doc.name, clientIp(_req));
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}

// Change a document's sharing scope. Only the owner can share their own upload;
// bundled samples are immutable.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (process.env.VELLUM_DEMO_MODE !== "1") {
    return NextResponse.json({ error: "dashboard_disabled" }, { status: 404 });
  }
  const { id } = await params;
  const doc = await getDoc(id);
  if (!doc) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (doc.bundled || doc.owner !== DEMO_VIEWER.owner) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const body = await req.json().catch(() => ({}));
  const visibility = normalizeVisibility(body?.visibility);
  const chapter = typeof body?.chapter === "string" ? body.chapter.trim().slice(0, 80) : "";
  setShare(id, { visibility, chapter });
  recordAudit("document.share", `${doc.name} (${visibility})`, clientIp(req));
  return NextResponse.json({ ok: true, visibility, chapter }, { headers: { "Cache-Control": "no-store" } });
}
