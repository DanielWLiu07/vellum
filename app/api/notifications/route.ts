import { NextRequest, NextResponse } from "next/server";
import { enterRequest } from "@/lib/auth";

import { recordAudit } from "@/lib/audit";
import { type NotificationKind, listFor, markAllRead, notify, unreadCount } from "@/lib/notifications";
import { getViewer } from "@/lib/profile";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { getKnownUser, listKnownUsers } from "@/lib/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function gated() {
  return process.env.VELLUM_DEMO_MODE !== "1"
    ? NextResponse.json({ error: "dashboard_disabled" }, { status: 404 })
    : null;
}

const noStore = { headers: { "Cache-Control": "no-store" } };

/**
 * The signed-in member's own notifications, newest first, plus the unread count
 * for the bell.
 *
 * There is no `?user=` parameter and there is not going to be one. Every other
 * oversight surface in Vitals widens by role - a trainer sees their chapter's
 * assignments, an admin sees everything - but a notification is not oversight.
 * It is one person's mail, and the only correct answer to "show me theirs" is
 * no. `getViewer().owner` is the whole authorisation model here.
 */
export async function GET(req: NextRequest) {
  await enterRequest(req);
  const off = gated();
  if (off) return off;

  const me = getViewer().owner;
  return NextResponse.json(
    { notifications: listFor(me), unread: unreadCount(me) },
    noStore,
  );
}

/**
 * Send a notification by hand. Admin only.
 *
 * Gated on `getViewer().admin`, which resolves from the SIGNED session - not
 * from the dashboard's "Preview as" switcher, which is a client-side preview
 * and grants nothing (spec §3.5). Previewing admin must not hand anyone a
 * broadcast channel to every member in the country.
 *
 * Body: { to: string | "all", title, body?, href? }
 */
export async function POST(req: NextRequest) {
  await enterRequest(req);
  const off = gated();
  if (off) return off;

  const viewer = getViewer();
  if (!viewer.admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  // A broadcast writes one row per member; rate-limited like the other writes.
  const rl = rateLimit(`notify:${clientIp(req)}`, 10, 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter), "Cache-Control": "no-store" } },
    );
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  const b = body as Record<string, unknown>;
  const title = typeof b.title === "string" ? b.title.trim() : "";
  if (!title) return NextResponse.json({ error: "bad_request" }, { status: 400 });

  const to = typeof b.to === "string" ? b.to.trim() : "";
  if (!to) return NextResponse.json({ error: "bad_request" }, { status: 400 });

  const kind: NotificationKind = "admin.broadcast";
  const shared = {
    actor: viewer.owner,
    kind,
    title,
    ...(typeof b.body === "string" && b.body.trim() ? { body: b.body.trim() } : {}),
    ...(typeof b.href === "string" && b.href.trim() ? { href: b.href.trim() } : {}),
  };

  if (to === "all") {
    // Everyone Vitals has actually seen (spec §4.4 - the directory is a cache of
    // members who have entered, not a roster of the membership).
    const recipients = listKnownUsers();
    let sent = 0;
    for (const member of recipients) {
      // notify() drops the admin's own copy on its own (actor === to).
      if (notify({ to: member.id, ...shared }).delivered) sent += 1;
    }
    recordAudit("notification.broadcast", title, `${sent} member${sent === 1 ? "" : "s"}`);
    return NextResponse.json({ ok: true, sent, scope: "all" }, noStore);
  }

  // A single recipient must be somebody Vitals knows, so a typo produces a 404
  // rather than a notification addressed into the void.
  const target = getKnownUser(to);
  if (!target) return NextResponse.json({ error: "unknown_recipient" }, { status: 404 });
  const res = notify({ to: target.id, ...shared });
  if (!res.delivered) {
    // "self" is the admin messaging themselves - an outcome, not a failure.
    return NextResponse.json({ ok: true, sent: 0, reason: res.reason }, noStore);
  }
  recordAudit("notification.send", title, `to ${target.name}`);
  return NextResponse.json({ ok: true, sent: 1, scope: "one" }, noStore);
}

/** Mark every one of the viewer's unread notifications read. */
export async function PATCH(req: NextRequest) {
  await enterRequest(req);
  const off = gated();
  if (off) return off;

  const changed = markAllRead(getViewer().owner);
  return NextResponse.json({ ok: true, changed }, noStore);
}
