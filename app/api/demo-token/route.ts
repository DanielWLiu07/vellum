/**
 * Demo-only token minting. In a real integration the HOST app mints tokens with
 * its own secret and a presigned source URL; the viewer never mints anything.
 * This endpoint exists purely so the public landing page can show a live demo
 * without a host app. Gated behind VELLUM_DEMO_MODE so production integrations
 * can disable it.
 */

import { NextRequest, NextResponse } from "next/server";

import { clientIp, rateLimit } from "@/lib/rate-limit";
import { mintToken } from "@/lib/token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (process.env.VELLUM_DEMO_MODE !== "1") {
    return NextResponse.json({ error: "demo_disabled" }, { status: 404 });
  }
  const rl = rateLimit(`demo:${clientIp(req)}`, 30, 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter), "Cache-Control": "no-store" } },
    );
  }
  const secret = process.env.VELLUM_TOKEN_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "not_configured" }, { status: 500 });
  }

  // The demo document lives in /public, fetched same-origin by the proxy.
  const origin = req.nextUrl.origin;
  const stamp = new Date().toISOString().replace("T", " ").slice(0, 16) + " UTC";

  const token = mintToken(secret, {
    src: `${origin}/sample.pdf`,
    watermark: `VELLUM DEMO • ${stamp}`,
    perms: { download: false, print: false, copy: false },
    ttlSeconds: 600,
  });

  return NextResponse.json({ token }, { headers: { "Cache-Control": "no-store" } });
}
