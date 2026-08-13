// The review surface: what approve and reject actually DO to a resource.
//
// These are end-to-end on purpose. Every bug this file covers was invisible in
// the queue module — resolveEntry recorded the right decision each time — and
// only appeared where the decision met resource-share: an approval that moved
// content it never held, a rejection that moved nothing at all, and a second
// reviewer's decision that changed nothing but was written down as though it
// had. Decks stand in for content throughout: they read their scope from the
// same share sidecar documents do, without needing the upload store.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { recordAudit } = vi.hoisted(() => ({ recordAudit: vi.fn() }));
vi.mock("@/lib/audit", () => ({ recordAudit }));

import { POST } from "./route";
import { SESSION_COOKIE } from "@/lib/auth";
import { createDeck, getDeck } from "@/lib/decks";
import { mintIdentityToken } from "@/lib/identity-token";
import { __resetModerationQueue, enqueue, getEntry } from "@/lib/moderation-queue";
import { __resetModules, createModule } from "@/lib/modules";
import { __resetProfile } from "@/lib/profile";
import { setShare } from "@/lib/resource-share";

const SECRET = "shared-secret-at-least-16-chars";
const ADMIN_A = { sub: "admin_a", name: "Admin A", chapter: "HOSA Canada", role: "admin" } as const;
const ADMIN_B = { sub: "admin_b", name: "Admin B", chapter: "HOSA Canada", role: "admin" } as const;
const MEMBER = { sub: "you", name: "You", chapter: "Toronto Central", role: "student" } as const;
type Person = typeof ADMIN_A | typeof ADMIN_B | typeof MEMBER;
const cookie = (p: Person) => `${SESSION_COOKIE}=${mintIdentityToken(SECRET, { ...p })}`;

const decide = (who: Person, body: unknown) =>
  POST(
    new NextRequest("https://v.test/api/moderation", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json", Cookie: cookie(who) },
    }),
  );

/** A live, public deck plus a member's open report against it. */
function reportedDeck(title = "Shared terms") {
  const deck = createDeck(title, [], "ava");
  const entry = enqueue({
    resourceId: deck.id,
    kind: "deck",
    owner: "ava",
    title,
    reason: "reported",
    reportedBy: "bea",
    reportReason: "copied straight out of a textbook",
  });
  return { deck, entry };
}

beforeEach(() => {
  process.env.VITALS_AUTH_SECRET = SECRET;
  __resetModerationQueue();
  __resetModules();
  __resetProfile();
});
afterEach(() => {
  delete process.env.VITALS_AUTH_SECRET;
  vi.clearAllMocks();
});

describe("deciding a reported entry", () => {
  // The bug: the report entry recorded the scope the resource had at report
  // time, and approve replayed it. Ava publishes, Ben reports, Ava thinks
  // better of it and goes private — and a reviewer dismissing the report puts
  // it back in front of everyone. A moderation action must never be how a
  // withdrawn file gets republished.
  it("dismissing a report does not republish something the owner has since made private", async () => {
    const { deck, entry } = reportedDeck();
    setShare(deck.id, { visibility: "private" }, undefined, "ava");
    expect(getDeck(deck.id)!.visibility).toBe("private");

    expect((await decide(ADMIN_A, { action: "approve", id: entry.id })).status).toBe(200);

    expect(getDeck(deck.id)!.visibility).toBe("private");
  });

  it("dismissing a report leaves a public resource public — it changes nothing at all", async () => {
    const { deck, entry } = reportedDeck();
    setShare(deck.id, { visibility: "chapter", chapter: "Toronto Central" }, undefined, "ava");

    await decide(ADMIN_A, { action: "approve", id: entry.id });

    expect(getDeck(deck.id)).toMatchObject({ visibility: "chapter", chapter: "Toronto Central" });
  });

  // The other half: a reviewer who AGREES with a report had no lever at all.
  // Approve restored a visibility and reject wrote nothing, so the only way to
  // act on reported content was to ban its owner.
  it("upholding a report takes the content private", async () => {
    const { deck, entry } = reportedDeck();
    expect(getDeck(deck.id)!.visibility).toBe("public");

    const res = await decide(ADMIN_A, { action: "reject", id: entry.id });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ enforced: true });
    expect(getDeck(deck.id)!.visibility).toBe("private");
  });

  // Private, not deleted, matching the console's Take down: reversing a
  // reviewer's mistake must not depend on the owner's work still existing.
  it("leaves named people on the resource so it can be looked at while it is sorted out", async () => {
    const { deck, entry } = reportedDeck();
    setShare(deck.id, { people: [{ person: "bea", role: "viewer" }] }, undefined, "ava");

    await decide(ADMIN_A, { action: "reject", id: entry.id });

    expect(getDeck(deck.id)!.people).toEqual([{ person: "bea", role: "viewer" }]);
  });

  // A module has no visibility to clamp, so the takedown cannot land. Saying
  // so is the point: an inert moderation action reported as done is the same
  // failure as a ban that bans nobody.
  it("admits when a takedown cannot be enforced for the kind of thing reported", async () => {
    const mod = createModule("Cardiology basics", "ava");
    const entry = enqueue({
      resourceId: mod.id,
      kind: "module",
      owner: "ava",
      title: mod.title,
      reason: "reported",
      reportedBy: "bea",
      reportReason: "wrong drug doses",
    });

    const res = await decide(ADMIN_A, { action: "reject", id: entry.id });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ enforced: false });
    expect(recordAudit).toHaveBeenCalledWith(
      "moderation.report_upheld",
      "Cardiology basics",
      expect.stringContaining("not enforceable"),
      "admin_a",
    );
  });

  // "moderation.approve" against a report is the same ambiguity the buttons
  // exist to kill, and nobody is around later to ask what it meant.
  it("records which way a report went, not a verb that could mean either", async () => {
    const { entry } = reportedDeck("Shared terms");
    await decide(ADMIN_A, { action: "approve", id: entry.id });

    expect(recordAudit).toHaveBeenCalledWith(
      "moderation.report_dismissed",
      "Shared terms",
      expect.any(String),
      "admin_a",
    );
  });
});

describe("deciding a held entry", () => {
  it("still restores the scope the creator asked for on approval", async () => {
    const deck = createDeck("Held deck", [], "ava");
    setShare(deck.id, { visibility: "private" }, undefined, "ava");
    const entry = enqueue({
      resourceId: deck.id,
      kind: "deck",
      owner: "ava",
      title: "Held deck",
      reason: "flagged",
      categories: ["violence"],
      requestedVisibility: "public",
    });

    await decide(ADMIN_A, { action: "approve", id: entry.id });

    expect(getDeck(deck.id)!.visibility).toBe("public");
  });

  it("keeps a rejected hold private", async () => {
    const deck = createDeck("Held deck", [], "ava");
    setShare(deck.id, { visibility: "private" }, undefined, "ava");
    const entry = enqueue({
      resourceId: deck.id,
      kind: "deck",
      owner: "ava",
      title: "Held deck",
      reason: "flagged",
      requestedVisibility: "public",
    });

    await decide(ADMIN_A, { action: "reject", id: entry.id });

    expect(getDeck(deck.id)!.visibility).toBe("private");
  });
});

describe("two reviewers, one entry", () => {
  // The audit log is the record a moderation dispute is settled from. It said
  // admin B rejected an item admin B never rejected, because resolveEntry
  // handed back the existing entry and the route read that as success.
  it("409s the second decision instead of reporting it as done", async () => {
    const { entry } = reportedDeck();
    expect((await decide(ADMIN_A, { action: "approve", id: entry.id })).status).toBe(200);

    const second = await decide(ADMIN_B, { action: "reject", id: entry.id });

    expect(second.status).toBe(409);
    expect(await second.json()).toMatchObject({
      error: "already_decided",
      entry: { status: "approved", reviewedBy: "admin_a" },
    });
  });

  it("writes no audit line for a decision that did not happen", async () => {
    const { entry } = reportedDeck();
    await decide(ADMIN_A, { action: "approve", id: entry.id });
    recordAudit.mockClear();

    await decide(ADMIN_B, { action: "reject", id: entry.id });

    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("does not act on the resource for the losing decision either", async () => {
    const { deck, entry } = reportedDeck();
    await decide(ADMIN_A, { action: "approve", id: entry.id });

    await decide(ADMIN_B, { action: "reject", id: entry.id });

    // The takedown belonged to a rejection that never took effect.
    expect(getDeck(deck.id)!.visibility).toBe("public");
    expect(getEntry(entry.id)).toMatchObject({ status: "approved", reviewedBy: "admin_a" });
  });

  it("404s an id that was never in the queue, distinct from one already decided", async () => {
    const res = await decide(ADMIN_A, { action: "approve", id: "mq_nope" });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });
});

describe("access", () => {
  it("forbids a non-admin from deciding anything", async () => {
    const { deck, entry } = reportedDeck();
    const res = await decide(MEMBER, { action: "reject", id: entry.id });

    expect(res.status).toBe(403);
    expect(getEntry(entry.id)!.status).toBe("pending");
    expect(getDeck(deck.id)!.visibility).toBe("public");
  });
});
