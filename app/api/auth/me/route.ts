import { NextRequest, NextResponse } from "next/server";

import { authConfigured, readIdentity, SESSION_COOKIE } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Who is signed in (for the client to show the member + a sign-out control).
export async function GET(req: NextRequest) {
  const id = readIdentity(req.cookies.get(SESSION_COOKIE)?.value);
  if (!id) {
    return NextResponse.json(
      { signedIn: false, authConfigured: authConfigured() },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
  return NextResponse.json(
    { signedIn: true, id: id.sub, name: id.name || id.sub, chapter: id.chapter, role: id.role },
    { headers: { "Cache-Control": "no-store" } },
  );
}
