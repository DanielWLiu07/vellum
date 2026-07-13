import { NextRequest, NextResponse } from "next/server";
import { enterRequest } from "@/lib/auth";

import { recordAudit } from "@/lib/audit";
import { flaggedReason, moderateText } from "@/lib/moderation";
import { getProfile, updateProfile } from "@/lib/profile";
import { clientIp, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function disabled() {
  return NextResponse.json({ error: "dashboard_disabled" }, { status: 404 });
}

/** The current profile. */
export async function GET(req: NextRequest) {
  await enterRequest(req);
  if (process.env.VELLUM_DEMO_MODE !== "1") return disabled();
  return NextResponse.json(getProfile(), { headers: { "Cache-Control": "no-store" } });
}

/** Update the profile. Free text (name + bio) is moderated before it lands. */
export async function PATCH(req: NextRequest) {
  await enterRequest(req);
  if (process.env.VELLUM_DEMO_MODE !== "1") return disabled();
  const rl = rateLimit(`profile:${clientIp(req)}`, 20, 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter), "Cache-Control": "no-store" } },
    );
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  const b = body as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v : undefined);
  const patch = {
    displayName: str(b.displayName),
    handle: str(b.handle),
    bio: str(b.bio),
    chapter: str(b.chapter),
    role: str(b.role),
    // null clears the avatar; a string sets it; undefined leaves it untouched.
    avatarImageId: b.avatarImageId === null ? null : str(b.avatarImageId),
  };

  // Moderate ALL the free text the user typed (name, bio, handle, chapter) -
  // each is rendered in the UI. Avatar images are moderated at upload time by
  // /api/images, so we don't re-check them here.
  const text = [patch.displayName, patch.bio, patch.handle, patch.chapter].filter(Boolean).join("\n").trim();
  if (text) {
    const mod = await moderateText(text);
    if (!mod.allowed) {
      recordAudit("profile.blocked", patch.displayName || "profile", flaggedReason(mod));
      return NextResponse.json({ error: "content_flagged", categories: mod.categories }, { status: 422 });
    }
  }

  const next = updateProfile(patch);
  recordAudit("profile.update", next.displayName);
  return NextResponse.json(next, { headers: { "Cache-Control": "no-store" } });
}
