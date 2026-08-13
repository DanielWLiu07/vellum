import { NextRequest, NextResponse } from "next/server";
import { enterRequest } from "@/lib/auth";

import { getDeck } from "@/lib/decks";
import { favoriteCount, favoriteCounts, isFavorite, listFavorites, setFavorite } from "@/lib/favorites";
import { getViewer } from "@/lib/profile";
import { getQuiz } from "@/lib/quizzes";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { ensureSeeded } from "@/lib/seed";
import { getDoc } from "@/lib/store";
import { canView } from "@/lib/visibility";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function disabled() {
  return NextResponse.json({ error: "dashboard_disabled" }, { status: 404 });
}

/**
 * Whether this id names something the viewer can actually see.
 *
 * The same check /api/comments makes on its target, and for a stronger reason:
 * a favorite is a WRITE into a store that is persisted on every change and read
 * back as a public like-count. Without this, any id at all could be saved —
 * 60/minute past the rate limit — which grew the store without bound and moved
 * the count on resources the writer was never shown. A count nobody can trace
 * to a real resource is not a weaker signal, it is a false one.
 *
 * The three favouritable kinds, matching where FavoriteButton is rendered:
 * documents, decks, quizzes. 404 rather than 403 on a miss, so this cannot be
 * used to probe which ids exist.
 */
async function viewable(id: string): Promise<boolean> {
  const viewer = getViewer();
  const doc = await getDoc(id);
  if (doc) return canView(doc, viewer);
  const deck = getDeck(id);
  if (deck) return canView(deck, viewer);
  const quiz = getQuiz(id);
  if (quiz) return canView(quiz, viewer);
  return false;
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
  // Seeded before resolving: the bundled sample and the demo decks/quizzes have
  // to exist before we can ask whether an id names one of them.
  await ensureSeeded();
  if (!(await viewable(id))) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const owner = getViewer().owner;
  const want = typeof raw?.favorite === "boolean" ? (raw.favorite as boolean) : !isFavorite(owner, id);
  const favorite = setFavorite(owner, id, want);
  return NextResponse.json(
    { id, favorite, count: favoriteCount(id) },
    { headers: { "Cache-Control": "no-store" } },
  );
}
