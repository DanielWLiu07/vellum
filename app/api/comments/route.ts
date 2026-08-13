import { NextRequest, NextResponse } from "next/server";
import { enterRequest } from "@/lib/auth";

import { recordAudit } from "@/lib/audit";
import { addComment, getComment, listComments, removeComment, type CommentTarget } from "@/lib/comments";
import { getModule } from "@/lib/modules";
import { moderateText } from "@/lib/moderation";
import { holdlessDisposition } from "@/lib/moderation-gate";
import { getViewer } from "@/lib/profile";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { getDoc } from "@/lib/store";
import { canView } from "@/lib/visibility";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function gated() {
  return process.env.VELLUM_DEMO_MODE !== "1"
    ? NextResponse.json({ error: "dashboard_disabled" }, { status: 404 })
    : null;
}

function normalizeType(v: unknown): CommentTarget | null {
  return v === "doc" || v === "module" ? v : null;
}

// Only allow comments on targets the viewer may actually see: a document they
// can view (public/shared resources), or an existing module. Returns 404 (no
// existence leak) otherwise.
async function targetOk(type: CommentTarget, id: string): Promise<boolean> {
  if (type === "module") return Boolean(getModule(id));
  const doc = await getDoc(id);
  return Boolean(doc && canView(doc, getViewer()));
}

/** List a target's comments. */
export async function GET(req: NextRequest) {
  await enterRequest(req);
  const off = gated();
  if (off) return off;
  const type = normalizeType(req.nextUrl.searchParams.get("type"));
  const target = req.nextUrl.searchParams.get("target") ?? "";
  if (!type || !target) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  if (!(await targetOk(type, target))) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ comments: listComments(type, target) }, { headers: { "Cache-Control": "no-store" } });
}

/** Post a comment (moderated, rate-limited). */
export async function POST(req: NextRequest) {
  await enterRequest(req);
  const off = gated();
  if (off) return off;
  const rl = rateLimit(`comment:${clientIp(req)}`, 20, 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter), "Cache-Control": "no-store" } },
    );
  }
  const body = await req.json().catch(() => null);
  const type = normalizeType(body?.type);
  const target = typeof body?.target === "string" ? body.target : "";
  const text = typeof body?.body === "string" ? body.body : "";
  if (!type || !target || !text.trim()) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  if (!(await targetOk(type, target))) return NextResponse.json({ error: "not_found" }, { status: 404 });

  // A comment is posted straight into a thread other members read, and there is
  // no private state to hold it in while a human looks — see
  // holdlessDisposition, which is where the reasoning lives. Both refusals cost
  // the author a retype and nothing more.
  const gate = holdlessDisposition(await moderateText(text));
  if (gate.action === "refuse" && gate.reason === "unchecked") {
    // The old `!mod.allowed` read a never-ran check as a pass, so an outage
    // published unexamined comments as though they had been cleared. 503, not
    // 422: nothing is wrong with what they wrote, and the same text will go
    // through once moderation answers again.
    recordAudit("comment.blocked", target, "not checked - moderation unavailable");
    return NextResponse.json(
      { error: "moderation_unavailable" },
      { status: 503, headers: { "Retry-After": "60", "Cache-Control": "no-store" } },
    );
  }
  if (gate.action === "refuse") {
    recordAudit("comment.blocked", target, gate.categories.join(", "));
    return NextResponse.json({ error: "content_flagged", categories: gate.categories }, { status: 422 });
  }
  const c = addComment({ targetType: type, targetId: target, author: getViewer().owner, body: text });
  if (!c) return NextResponse.json({ error: "empty" }, { status: 400 });
  recordAudit("comment.post", target);
  return NextResponse.json({ comment: c }, { headers: { "Cache-Control": "no-store" } });
}

/** Delete a comment — the author or an admin only. */
export async function DELETE(req: NextRequest) {
  await enterRequest(req);
  const off = gated();
  if (off) return off;
  const body = await req.json().catch(() => null);
  const id = typeof body?.id === "string" ? body.id : "";
  const c = getComment(id);
  if (!c) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const viewer = getViewer();
  if (c.author !== viewer.owner && !viewer.admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  removeComment(id);
  recordAudit("comment.delete", c.targetId);
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
