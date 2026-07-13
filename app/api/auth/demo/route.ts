import { NextRequest, NextResponse } from "next/server";

import { recordAudit } from "@/lib/audit";
import { SESSION_COOKIE } from "@/lib/auth";
import { ensureReady } from "@/lib/bootstrap";
import { type MemberRole, mintIdentityToken } from "@/lib/identity-token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROLES: MemberRole[] = ["student", "trainer", "advisor", "admin"];
const NAMES: Record<MemberRole, string> = {
  student: "Demo Student",
  trainer: "Demo Trainer",
  advisor: "Demo Advisor",
  admin: "Demo Admin",
};

// Demo sign-in: mints an identity token locally (standing in for the HOSA
// handoff) so the auth flow is testable without the main site. Demo-mode only.
export async function GET(req: NextRequest) {
  if (process.env.VELLUM_DEMO_MODE !== "1") {
    return NextResponse.json({ error: "demo_disabled" }, { status: 404 });
  }
  const secret = process.env.VITALS_AUTH_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "not_configured" }, { status: 500 });
  }
  const asParam = req.nextUrl.searchParams.get("as");
  const role: MemberRole = ROLES.includes(asParam as MemberRole) ? (asParam as MemberRole) : "student";
  const token = mintIdentityToken(secret, {
    sub: `demo_${role}`,
    name: NAMES[role],
    chapter: "Toronto Central",
    role,
    ttlSeconds: 8 * 3600,
  });
  await ensureReady();
  recordAudit("auth.signin", NAMES[role], undefined, `demo_${role}`);
  // Optional post-sign-in landing. Only a same-origin relative path is allowed
  // (must start with a single "/") so this can't be used as an open redirect.
  const nextParam = req.nextUrl.searchParams.get("next") ?? "";
  const dest = nextParam.startsWith("/") && !nextParam.startsWith("//") ? nextParam : "/dashboard";
  const res = NextResponse.redirect(new URL(dest, req.nextUrl.origin));
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 8 * 3600,
  });
  return res;
}
