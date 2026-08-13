import { NextRequest, NextResponse } from "next/server";
import { enterRequest } from "@/lib/auth";

import { recordAudit } from "@/lib/audit";
import { moderateText } from "@/lib/moderation";
import { holdlessDisposition } from "@/lib/moderation-gate";
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
  // A member's chapter comes from their HOSA account, carried in the signed
  // session. Accepting one here let someone type their way into another
  // chapter's assignments and roster. We REJECT rather than quietly drop it:
  // silently 200-ing a chapter change the server didn't make is a lie the
  // client would render as success.
  if (b.chapter !== undefined) {
    return NextResponse.json({ error: "chapter_not_editable" }, { status: 400 });
  }
  const str = (v: unknown) => (typeof v === "string" ? v : undefined);
  const patch = {
    displayName: str(b.displayName),
    handle: str(b.handle),
    bio: str(b.bio),
    // `role` is deliberately NOT accepted either. With no session getViewer()
    // derives `admin` from the local profile, so honouring a role patch let any
    // signed-out visitor grant themselves admin (audit log, delete/edit on any
    // doc, official-content locks) straight from the profile form. Role comes
    // from the signed HOSA session only. Unlike chapter it is dropped rather
    // than rejected, to stay compatible with clients that echo the whole
    // profile back on save.
    // null clears the avatar; a string sets it; undefined leaves it untouched.
    avatarImageId: b.avatarImageId === null ? null : str(b.avatarImageId),
  };

  // Moderate ALL the free text the user typed (name, bio, handle) - each is
  // rendered in the UI. Chapter is no longer among them: it isn't typed, it
  // comes from the signed session. Avatar images are moderated at upload time
  // by /api/images, so we don't re-check them here.
  const text = [patch.displayName, patch.bio, patch.handle].filter(Boolean).join("\n").trim();
  if (text) {
    // A profile has one live copy of each field, shown next to this member's
    // name wherever they appear. There is no draft state to hold an edit in, so
    // a refused edit simply leaves the previous values standing — nothing the
    // member had is lost. See holdlessDisposition.
    const gate = holdlessDisposition(await moderateText(text));
    if (gate.action === "refuse" && gate.reason === "unchecked") {
      // Was a silent pass: a skipped check reports allowed:true, so during an
      // outage a bio went live having been examined by nobody.
      recordAudit("profile.blocked", patch.displayName || "profile", "not checked - moderation unavailable");
      return NextResponse.json(
        { error: "moderation_unavailable" },
        { status: 503, headers: { "Retry-After": "60", "Cache-Control": "no-store" } },
      );
    }
    if (gate.action === "refuse") {
      recordAudit("profile.blocked", patch.displayName || "profile", gate.categories.join(", "));
      return NextResponse.json({ error: "content_flagged", categories: gate.categories }, { status: 422 });
    }
  }

  const next = updateProfile(patch);
  recordAudit("profile.update", next.displayName);
  return NextResponse.json(next, { headers: { "Cache-Control": "no-store" } });
}
