import { NextRequest, NextResponse } from "next/server";

import { ensureReady } from "@/lib/bootstrap";
import { isModuleDoc } from "@/lib/modules";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { deckPageCount, deckPageImage } from "@/lib/slides-render";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Custom scroll viewer backend. `?id=<deckId>` returns the slide count;
// `?id=<deckId>&page=<n>` returns that slide rendered to a PNG. The id is
// validated to the Slides id charset and only ever used to build the fixed
// docs.google.com export URL (no SSRF).
export async function GET(req: NextRequest) {
  if (process.env.VELLUM_DEMO_MODE !== "1") {
    return NextResponse.json({ error: "dashboard_disabled" }, { status: 404 });
  }
  // Each request can trigger a Google export fetch + PDF-page render, so bound
  // it - this endpoint is otherwise an unauthenticated render amplifier.
  const rl = rateLimit(`slides-image:${clientIp(req)}`, 300, 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter), "Cache-Control": "no-store" } },
    );
  }
  const id = req.nextUrl.searchParams.get("id") ?? "";
  if (!/^[A-Za-z0-9_-]{10,120}$/.test(id)) {
    return NextResponse.json({ error: "bad_id" }, { status: 400 });
  }
  const k = req.nextUrl.searchParams.get("kind");
  const kind = k === "doc" || k === "pdf" ? k : "slides";

  // A PDF id points at OUR upload storage, so only render docs a module actually
  // references - never an arbitrary (possibly private) upload. Google ids are
  // public link-shared files, so they need no such gate.
  if (kind === "pdf") {
    await ensureReady();
    if (!isModuleDoc(id)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const pageParam = req.nextUrl.searchParams.get("page");
  if (pageParam === null) {
    const pages = await deckPageCount(kind, id).catch(() => null);
    if (pages === null) return NextResponse.json({ error: "unavailable" }, { status: 502 });
    return NextResponse.json({ pages }, { headers: { "Cache-Control": "private, max-age=600" } });
  }

  const page = Number(pageParam);
  if (!Number.isInteger(page) || page < 1 || page > 500) {
    return NextResponse.json({ error: "bad_page" }, { status: 400 });
  }
  const img = await deckPageImage(kind, id, page).catch(() => null);
  if (!img) return NextResponse.json({ error: "unavailable" }, { status: 502 });
  return new NextResponse(img, {
    status: 200,
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
