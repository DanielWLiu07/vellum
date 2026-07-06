import { NextRequest, NextResponse } from "next/server";

import { recordAudit } from "@/lib/audit";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { copyDoc, getDoc } from "@/lib/store";
import { DEMO_VIEWER, canView } from "@/lib/visibility";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Google-Docs "Make a copy" for a document: anyone who can view it can clone
// it. The copy is a fresh upload owned by the caller and starts private —
// this is also the editing story for immutable resources (bundled samples,
// other people's docs): copy first, then the copy is fully yours.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (process.env.VELLUM_DEMO_MODE !== "1") {
    return NextResponse.json({ error: "dashboard_disabled" }, { status: 404 });
  }
  const rl = rateLimit(`copy:${clientIp(req)}`, 10, 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter), "Cache-Control": "no-store" } },
    );
  }
  const { id } = await params;
  const doc = await getDoc(id);
  if (!doc) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!canView(doc, DEMO_VIEWER)) return NextResponse.json({ error: "not_found" }, { status: 404 }); // no existence leak

  const copy = await copyDoc(id, DEMO_VIEWER.owner, DEMO_VIEWER.chapter);
  if (!copy) return NextResponse.json({ error: "not_found" }, { status: 404 });
  recordAudit("document.copy", copy.name, clientIp(req));
  return NextResponse.json(
    { id: copy.id, name: copy.name, sizeBytes: copy.sizeBytes },
    { headers: { "Cache-Control": "no-store" } },
  );
}
