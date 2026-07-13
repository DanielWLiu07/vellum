import { NextRequest, NextResponse } from "next/server";
import { enterRequest } from "@/lib/auth";

import { favoriteCount, favoriteCounts, isFavorite, listFavorites, setFavorite } from "@/lib/favorites";
import { getViewer } from "@/lib/profile";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { ensureSeeded } from "@/lib/seed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function disabled() {
  return NextResponse.json({ error: "dashboard_disabled" }, { status: 404 });
}

/** The current viewer's saved resource ids. */
export async function GET(req: NextRequest) {
  await enterRequest(req);
  if (process.env.VELLUM_DEMO_MODE !== "1") return disabled();
  await ensureSeeded(); // populate demo like-counts regardless of call order
  return NextResponse.json(
    { ids: listFavorites(getViewer().owner), counts: favoriteCounts() },
    { headers: { "Cache-Control": "no-store" } },
  );
}

/**
 * Toggle a resource's saved state for the current viewer. Body: { id,
 * favorite? }. When `favorite` is omitted the current state is flipped.
 */
export async function POST(req: NextRequest) {
  await enterRequest(req);
  if (process.env.VELLUM_DEMO_MODE !== "1") return disabled();
  const rl = rateLimit(`favorites:${clientIp(req)}`, 60, 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter), "Cache-Control": "no-store" } },
    );
  }

  const body = await req.json().catch(() => null);
  const raw = body && typeof body === "object" ? (body as Record<string, unknown>) : null;
  // Truncate ONCE so the check, the write, and the count all use the same key.
  const id = typeof raw?.id === "string" ? raw.id.slice(0, 128) : "";
  if (!id) return NextResponse.json({ error: "bad_request" }, { status: 400 });

  const owner = getViewer().owner;
  const want = typeof raw?.favorite === "boolean" ? (raw.favorite as boolean) : !isFavorite(owner, id);
  const favorite = setFavorite(owner, id, want);
  return NextResponse.json(
    { id, favorite, count: favoriteCount(id) },
    { headers: { "Cache-Control": "no-store" } },
  );
}
