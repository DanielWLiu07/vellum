import { NextRequest, NextResponse } from "next/server";
import { enterRequest } from "@/lib/auth";

import { recordAudit } from "@/lib/audit";
import { deleteModule, getModule, updateModule } from "@/lib/modules";
import { flaggedReason, moderateText } from "@/lib/moderation";
import { getViewer } from "@/lib/profile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function gated() {
  return process.env.VELLUM_DEMO_MODE !== "1"
    ? NextResponse.json({ error: "dashboard_disabled" }, { status: 404 })
    : null;
}

/** Full module (sections + slides) for the player or the editor. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await enterRequest(req);
  const off = gated();
  if (off) return off;
  const { id } = await params;
  const mod = getModule(id);
  if (!mod) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ module: mod, canEdit: getViewer().admin && id !== "sample-module" }, { headers: { "Cache-Control": "no-store" } });
}

/** Edit a module (title/summary/sections+slides) - admin only. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await enterRequest(req);
  const off = gated();
  if (off) return off;
  if (!getViewer().admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "bad_request" }, { status: 400 });

  // Moderate the authored TEXT (module + section + part titles, and the body of
  // every written-info block). Slides live in Google Slides - their content
  // isn't ours to moderate here.
  //
  // A part carries its text in `blocks` now, but an editor tab left open across
  // a deploy still PATCHes the old single-artifact shape, and lib/modules will
  // accept it. Anything moderation skips is text that gets stored, so this walk
  // reads both shapes rather than assuming the new one.
  const texts: string[] = [];
  const pushText = (v: unknown) => { if (typeof v === "string") texts.push(v); };
  const pushInfoBody = (v: { kind?: unknown; body?: unknown }) => { if (v.kind === "info") pushText(v.body); };
  pushText(body.title);
  pushText(body.summary);
  if (Array.isArray(body.sections)) {
    for (const s of body.sections) {
      if (!s || typeof s !== "object") continue;
      pushText(s.title);
      const subs = Array.isArray(s.subsections) ? s.subsections : [];
      for (const ss of subs) {
        if (!ss || typeof ss !== "object") continue;
        pushText(ss.title);
        pushInfoBody(ss); // pre-blocks shape: the part IS its one artifact
        for (const b of Array.isArray(ss.blocks) ? ss.blocks : []) {
          if (b && typeof b === "object") pushInfoBody(b);
        }
      }
    }
  }
  const mod = await moderateText(texts.filter(Boolean).join("\n"));
  if (!mod.allowed) {
    recordAudit("module.blocked", (typeof body.title === "string" && body.title) || "module", flaggedReason(mod));
    return NextResponse.json({ error: "content_flagged", categories: mod.categories }, { status: 422 });
  }

  const updated = updateModule(id, { title: body.title, summary: body.summary, sections: body.sections });
  if (!updated) return NextResponse.json({ error: "not_found" }, { status: 404 });
  recordAudit("module.update", updated.title);
  return NextResponse.json({ module: updated }, { headers: { "Cache-Control": "no-store" } });
}

/** Delete a module - admin only. The seeded sample is immutable. */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await enterRequest(req);
  const off = gated();
  if (off) return off;
  if (!getViewer().admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { id } = await params;
  const mod = getModule(id);
  const ok = deleteModule(id);
  if (!ok) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (mod) recordAudit("module.delete", mod.title);
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
