import { NextResponse } from "next/server";

import { listAudit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (process.env.VELLUM_DEMO_MODE !== "1") {
    return NextResponse.json({ error: "dashboard_disabled" }, { status: 404 });
  }
  return NextResponse.json({ events: listAudit() }, { headers: { "Cache-Control": "no-store" } });
}
