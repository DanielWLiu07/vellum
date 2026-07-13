import { NextRequest, NextResponse } from "next/server";

import { recordAudit } from "@/lib/audit";
import { readIdentity, SESSION_COOKIE } from "@/lib/auth";
import { ensureReady } from "@/lib/bootstrap";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The HOSA handoff endpoint. The main site redirects a signed-in member here
// with a signed identity token; we verify it (shared secret) and set the
// session cookie, then land them on the dashboard.
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  const id = readIdentity(token);
  if (!id) {
    return NextResponse.json({ error: "invalid_token" }, { status: 401 });
  }
  await ensureReady();
  recordAudit("auth.signin", id.name || id.sub, undefined, id.sub);
  const res = NextResponse.redirect(new URL("/dashboard", req.nextUrl.origin));
  res.cookies.set(SESSION_COOKIE, token!, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: Math.max(0, id.exp - Math.floor(Date.now() / 1000)),
  });
  return res;
}
