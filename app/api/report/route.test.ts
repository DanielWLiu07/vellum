// Report API: a member telling a human that content shouldn't be here.
//
// The two properties worth defending are here rather than in lib, because both
// are only true end to end: a report must not move the content's visibility,
// and a report must not reveal the existence of something the reporter can't
// already see. Tested against modules and decks to stay off the upload store,
// the same way the comments route tests do.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn() }));

import { POST } from "./route";
import { SESSION_COOKIE } from "@/lib/auth";
import { createDeck, getDeck } from "@/lib/decks";
import { mintIdentityToken } from "@/lib/identity-token";
import { __resetModerationQueue, isQuarantined, listPending } from "@/lib/moderation-queue";
import { __resetModules, createModule } from "@/lib/modules";
import { __resetProfile } from "@/lib/profile";
import { __resetRateLimit } from "@/lib/rate-limit";
import { setShare } from "@/lib/resource-share";

const SECRET = "shared-secret-at-least-16-chars";
const MEMBER = { sub: "you", name: "You", chapter: "Toronto Central", role: "student" } as const;
const OTHER = { sub: "bea", name: "Bea", chapter: "Toronto Central", role: "student" } as const;
type Person = typeof MEMBER | typeof OTHER;
const cookie = (p: Person) => `${SESSION_COOKIE}=${mintIdentityToken(SECRET, { ...p })}`;

const report = (body: unknown, who: Person | null = MEMBER) =>
  POST(
    new NextRequest("https://v.test/api/report", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json", ...(who ? { Cookie: cookie(who) } : {}) },
    }),
  );

let modId = "";
beforeEach(() => {
  process.env.VELLUM_DEMO_MODE = "1";
  process.env.VITALS_AUTH_SECRET = SECRET;
  __resetModerationQueue();
  __resetModules();
  __resetProfile();
  __resetRateLimit();
  modId = createModule("Cardiology basics", "ava").id;
});
afterEach(() => {
  delete process.env.VELLUM_DEMO_MODE;
  delete process.env.VITALS_AUTH_SECRET;
  vi.clearAllMocks();
});

describe("POST /api/report", () => {
  it("queues a report carrying the reporter and their words", async () => {
    const res = await report({ kind: "module", id: modId, reason: "this is someone's exam paper" });
    expect(res.status).toBe(200);

    const [entry] = listPending();
    expect(entry).toMatchObject({
      resourceId: modId,
      kind: "module",
      // The owner is the person a reviewer would act against, not the reporter.
      owner: "ava",
      title: "Cardiology basics",
      reason: "reported",
      reportedBy: "you",
      reportReason: "this is someone's exam paper",
      status: "pending",
    });
  });

  // The whole point of the feature's design. One member pressing Report must
  // not be able to pull another member's work offline — that decision belongs
  // to the reviewer, and until they make it the content stays exactly as it was.
  it("does not change what anyone can see", async () => {
    const deck = createDeck("Shared terms", [], "ava");
    expect(getDeck(deck.id)!.visibility).toBe("public");

    await report({ kind: "deck", id: deck.id, reason: "copied from a textbook" });

    expect(getDeck(deck.id)!.visibility).toBe("public");
    expect(isQuarantined(deck.id)).toBe(false);
  });

  // A report holds nothing, so there is nothing for an approval to give back.
  // Recording the scope the resource happened to have at report time looked
  // harmless and wasn't: /api/moderation replayed it on approval, so dismissing
  // a report re-published a file its owner had made private in the meantime.
  // Nothing restorable is stored, so there is nothing left to replay.
  it("stores no visibility for a review to restore later", async () => {
    const deck = createDeck("Chapter notes", [], "ava");
    setShare(deck.id, { visibility: "chapter", chapter: "Toronto Central" }, undefined, "ava");

    await report({ kind: "deck", id: deck.id, reason: "wrong drug doses throughout" });

    expect(listPending()[0]!.requestedVisibility).toBe("private");
    // And the report itself still left the deck exactly where it was.
    expect(getDeck(deck.id)).toMatchObject({ visibility: "chapter" });
  });

  it("404s something that doesn't exist", async () => {
    expect((await report({ kind: "module", id: "m_missing", reason: "bad" })).status).toBe(404);
    expect(listPending()).toHaveLength(0);
  });

  // Not 403: a distinct status would confirm the id is real, which turns Report
  // into a way to enumerate other people's private resources.
  it("404s a resource the reporter can't see, the same as a missing one", async () => {
    const secret = createDeck("Someone else's private deck", [], "ava");
    setShare(secret.id, { visibility: "private" }, undefined, "ava");

    const res = await report({ kind: "deck", id: secret.id, reason: "bad" });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });

  it("400s a blank reason — a report with no case is nothing a reviewer can act on", async () => {
    expect((await report({ kind: "module", id: modId, reason: "   " })).status).toBe(400);
    expect((await report({ kind: "module", id: modId })).status).toBe(400);
    expect(listPending()).toHaveLength(0);
  });

  it("400s an unknown resource kind", async () => {
    expect((await report({ kind: "bogus", id: modId, reason: "bad" })).status).toBe(400);
  });

  it("401s an unauthenticated caller — an anonymous accusation is unweighable", async () => {
    // Fresh module registry, and therefore a fresh AsyncLocalStorage. Inside
    // one test process resolveViewer only ever SETS a session and never clears
    // one, so a cookie from an earlier request in this file is still in the
    // store and a cookie-less call would look signed in. Next gives each
    // request its own context, so this is a harness artifact — but it means the
    // signed-out path has to be exercised on a clean graph to mean anything.
    vi.resetModules();
    const { POST: freshPost } = await import("./route");
    const res = await freshPost(
      new NextRequest("https://v.test/api/report", {
        method: "POST",
        body: JSON.stringify({ kind: "module", id: modId, reason: "bad" }),
        headers: { "Content-Type": "application/json" },
      }),
    );
    expect(res.status).toBe(401);
    expect(listPending()).toHaveLength(0);
  });

  it("folds a repeat report by the same member into their open one", async () => {
    const first = await (await report({ kind: "module", id: modId, reason: "first go" })).json();
    const again = await report({ kind: "module", id: modId, reason: "same thing again" });

    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ ok: true, id: first.id, duplicate: true });
    expect(listPending()).toHaveLength(1);
  });

  // Two people independently reporting one thing is the strongest signal a
  // reviewer gets. Deduplicating by resource would throw it away.
  it("keeps a second member's report of the same thing as its own entry", async () => {
    await report({ kind: "module", id: modId, reason: "mine" }, MEMBER);
    await report({ kind: "module", id: modId, reason: "and mine" }, OTHER);

    expect(listPending()).toHaveLength(2);
    expect(listPending().map((e) => e.reportedBy)).toEqual(["you", "bea"]);
  });

  it("rate limits a burst, so the queue can't be buried", async () => {
    for (let i = 0; i < 5; i++) {
      const m = createModule(`M${i}`, "ava").id;
      expect((await report({ kind: "module", id: m, reason: "bad" })).status).toBe(200);
    }
    const sixth = await report({ kind: "module", id: modId, reason: "bad" });
    expect(sixth.status).toBe(429);
    expect(sixth.headers.get("Retry-After")).toBeTruthy();
  });

  it("404s entirely when the dashboard is disabled", async () => {
    delete process.env.VELLUM_DEMO_MODE;
    expect((await report({ kind: "module", id: modId, reason: "bad" })).status).toBe(404);
  });
});
