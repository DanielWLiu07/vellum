import { NextRequest, NextResponse } from "next/server";

import { recordAudit } from "@/lib/audit";
import { mintSessionToken, readIdentity, SESSION_COOKIE, SESSION_TTL_SECONDS } from "@/lib/auth";
import { ensureReady } from "@/lib/bootstrap";
import { rememberUser } from "@/lib/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The HOSA handoff endpoint. The main site redirects a signed-in member here
// with a signed identity token; we verify it (shared secret) and set the
// session cookie, then land them on the dashboard.
//
// The cookie is a FRESH token, not the one from the URL. A query parameter is
// copied into access logs and browser history, so reusing it as the session
// turned every logged request line into a working eight-hour login. Minting
// here means the URL token only has to live long enough to be redeemed.
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  const id = readIdentity(token);
  if (!id) {
    return NextResponse.json(
      { error: "invalid_token" },
      { status: 401, headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } },
    );
  }
  await ensureReady();
  // Entering is how Vitals learns a member exists - this is what puts them on
  // their chapter's roster so a trainer can assign them work.
  rememberUser(id);
  recordAudit("auth.signin", id.name || id.sub, undefined, id.sub);
  const res = NextResponse.redirect(new URL("/dashboard", req.nextUrl.origin));
  // Keep the token out of any shared cache, and out of the Referer sent from
  // the landing page - both would re-expose what we just took care to rotate.
  res.headers.set("Cache-Control", "no-store");
  res.headers.set("Referrer-Policy", "no-referrer");
  res.cookies.set(SESSION_COOKIE, mintSessionToken(id), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
  return res;
}
