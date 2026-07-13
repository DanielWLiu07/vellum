import { NextRequest, NextResponse } from "next/server";
import { enterRequest } from "@/lib/auth";

import { recordAudit } from "@/lib/audit";
import { listFeedback, setResolved, submitFeedback } from "@/lib/feedback";
import { getViewer } from "@/lib/profile";
import { clientIp, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function gated() {
  return process.env.VELLUM_DEMO_MODE !== "1"
    ? NextResponse.json({ error: "dashboard_disabled" }, { status: 404 })
    : null;
}

/** File a feedback / bug report. Anyone signed in can submit. */
export async function POST(req: NextRequest) {
  await enterRequest(req);
  const off = gated();
  if (off) return off;
  const rl = rateLimit(`feedback:${clientIp(req)}`, 10, 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter), "Cache-Control": "no-store" } },
    );
  }
  const body = await req.json().catch(() => null);
  const item = submitFeedback({
    kind: body?.kind,
    message: body?.message,
    page: body?.page,
    reporter: getViewer().owner,
  });
  if (!item) return NextResponse.json({ error: "empty_message" }, { status: 400 });
  recordAudit("feedback.submit", item.kind, undefined, item.reporter);
  return NextResponse.json({ id: item.id }, { headers: { "Cache-Control": "no-store" } });
}

/** List reports — admin only (they carry other members' words + context). */
export async function GET(req: NextRequest) {
  await enterRequest(req);
  const off = gated();
  if (off) return off;
  if (!getViewer().admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  return NextResponse.json({ feedback: listFeedback() }, { headers: { "Cache-Control": "no-store" } });
}

/** Resolve or reopen a report — admin only. */
export async function PATCH(req: NextRequest) {
  await enterRequest(req);
  const off = gated();
  if (off) return off;
  if (!getViewer().admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const body = await req.json().catch(() => null);
  const id = typeof body?.id === "string" ? body.id : "";
  const item = setResolved(id, body?.resolved !== false);
  if (!item) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ feedback: item }, { headers: { "Cache-Control": "no-store" } });
}
