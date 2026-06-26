import { NextRequest, NextResponse } from "next/server";

import { getDoc } from "@/lib/store";
import { mintToken } from "@/lib/token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Mints a capability token for a stored document and returns the embeddable
// viewer URL. This is the same token flow a host app uses — the dashboard is
// just driving it locally.
export async function POST(req: NextRequest) {
  if (process.env.VELLUM_DEMO_MODE !== "1") {
    return NextResponse.json({ error: "dashboard_disabled" }, { status: 404 });
  }
  const secret = process.env.VELLUM_TOKEN_SECRET;
  if (!secret) return NextResponse.json({ error: "not_configured" }, { status: 500 });

  const body = await req.json().catch(() => ({}));
  const id = typeof body?.id === "string" ? body.id : "";
  const doc = getDoc(id);
  if (!doc) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const watermark = typeof body?.watermark === "string" ? body.watermark.slice(0, 120) : "";
  const ttlMinutes = Math.min(60, Math.max(1, Number(body?.ttlMinutes) || 15));

  const token = mintToken(secret, {
    src: `${req.nextUrl.origin}/api/doc/${id}`,
    watermark,
    perms: { download: body?.download === true, print: body?.print === true, copy: false },
    ttlSeconds: ttlMinutes * 60,
  });

  const frag = new URLSearchParams({ t: token });
  if (body?.mode === "slides") frag.set("mode", "slides");
  return NextResponse.json(
    { embedUrl: `/embed#${frag.toString()}`, expiresInMinutes: ttlMinutes },
    { headers: { "Cache-Control": "no-store" } },
  );
}
