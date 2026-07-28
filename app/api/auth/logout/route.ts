import { NextRequest, NextResponse } from "next/server";

import { recordAudit } from "@/lib/audit";
import { readIdentity, SESSION_COOKIE } from "@/lib/auth";
import { ensureReady } from "@/lib/bootstrap";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const id = readIdentity(req.cookies.get(SESSION_COOKIE)?.value);
  if (id) {
    await ensureReady();
    recordAudit("auth.signout", id.name || id.sub, undefined, id.sub);
  }
  const res = NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  res.cookies.delete(SESSION_COOKIE);
  return res;
}
