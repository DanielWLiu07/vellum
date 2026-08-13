// Deleting a resource that is sitting in the moderation queue.
//
// One concern across three delete routes, so it lives here rather than in each
// route's own file (same shape as route-moderation.test.ts). Nothing called
// deleteQueueFor at all, which left two live faults behind every delete: the
// review queue kept offering an entry whose resource was gone — approving it
// answered not_found — and isQuarantined stayed true for that id for the life
// of the process, so it could never be trusted again.
//
// The second half is the judgement call: deleting your own work while a
// reviewer is looking at it is allowed, because refusing would keep REPORTED
// content (which stays visible while it waits) up until a human got to it. The
// audit line is what stops that being free, so these assert the record as
// firmly as the cleanup.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { recordAudit } = vi.hoisted(() => ({ recordAudit: vi.fn() }));
vi.mock("@/lib/audit", () => ({ recordAudit }));

import { DELETE as deckDelete } from "./decks/[id]/route";
import { DELETE as docDelete } from "./doc/[id]/route";
import { DELETE as quizDelete } from "./quizzes/[id]/route";
import { createDeck } from "@/lib/decks";
import {
  __resetModerationQueue,
  enqueue,
  isQuarantined,
  listQueue,
  resolveEntry,
} from "@/lib/moderation-queue";
import { createQuiz } from "@/lib/quizzes";
import { addUpload } from "@/lib/store";

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const req = () => new NextRequest("https://v.test/api/x", { method: "DELETE" });

/** The demo viewer with no session is "you", which is who these must own. */
const ME = "you";

const hold = (resourceId: string, over: Partial<Parameters<typeof enqueue>[0]> = {}) =>
  enqueue({
    resourceId,
    kind: "document",
    owner: ME,
    title: "Lab safety briefing",
    reason: "flagged",
    categories: ["violence"],
    ...over,
  });

beforeEach(() => {
  process.env.VELLUM_DEMO_MODE = "1";
  __resetModerationQueue();
});
afterEach(() => {
  delete process.env.VELLUM_DEMO_MODE;
  vi.clearAllMocks();
});

describe("DELETE /api/doc/[id]", () => {
  const upload = () =>
    addUpload("notes.pdf", new Uint8Array(4).fill(0x25), "application/pdf", {
      visibility: "private",
      chapter: "",
      owner: ME,
    });

  it("takes the document's queue entries with it", async () => {
    const doc = await upload();
    hold(doc.id);

    expect((await docDelete(req(), ctx(doc.id))).status).toBe(200);

    expect(listQueue()).toHaveLength(0);
  });

  // The one the queue could never recover from on its own: an id quarantined
  // by an entry for a resource that no longer exists is quarantined forever.
  it("stops quarantining an id whose resource is gone", async () => {
    const doc = await upload();
    hold(doc.id);
    expect(isQuarantined(doc.id)).toBe(true);

    await docDelete(req(), ctx(doc.id));

    expect(isQuarantined(doc.id)).toBe(false);
  });

  it("records that something under review was deleted, and what it was under review for", async () => {
    const doc = await upload();
    hold(doc.id, { reason: "reported", reportedBy: "bea", reportReason: "scan of a textbook" });

    await docDelete(req(), ctx(doc.id));

    expect(recordAudit).toHaveBeenCalledWith(
      "moderation.deleted_under_review",
      "notes.pdf",
      "reported by bea",
    );
  });

  // An ordinary delete is an ordinary delete. A line claiming a review was
  // dodged every time anyone tidied up would make the real ones unfindable.
  it("writes no review line when nothing was in the queue", async () => {
    const doc = await upload();

    await docDelete(req(), ctx(doc.id));

    expect(recordAudit).toHaveBeenCalledWith("document.delete", "notes.pdf");
    expect(recordAudit).not.toHaveBeenCalledWith(
      "moderation.deleted_under_review",
      expect.anything(),
      expect.anything(),
    );
  });

  // A decided entry is nobody's open question. Its decision is already in the
  // audit log permanently, so removing the row is cleanup, not an event.
  it("cleans up a decided entry without calling it a dodge", async () => {
    const doc = await upload();
    const e = hold(doc.id);
    resolveEntry(e.id, "rejected", "admin");

    await docDelete(req(), ctx(doc.id));

    expect(listQueue()).toHaveLength(0);
    expect(recordAudit).not.toHaveBeenCalledWith(
      "moderation.deleted_under_review",
      expect.anything(),
      expect.anything(),
    );
  });

  // A refused delete must not strip the review that is still running against it.
  it("leaves the queue intact when the delete itself is refused", async () => {
    const theirs = await addUpload("theirs.pdf", new Uint8Array(4), "application/pdf", {
      visibility: "public",
      chapter: "",
      owner: "someone-else",
    });
    hold(theirs.id, { owner: "someone-else" });

    expect((await docDelete(req(), ctx(theirs.id))).status).toBe(403);

    expect(listQueue()).toHaveLength(1);
    expect(isQuarantined(theirs.id)).toBe(true);
  });
});

describe("DELETE /api/decks/[id]", () => {
  it("takes the deck's queue entries with it and records the deletion", async () => {
    const deck = createDeck("Shared terms", [{ front: "a", back: "b" }], ME);
    hold(deck.id, { kind: "deck", title: "Shared terms", reason: "submitted", categories: [] });

    expect((await deckDelete(req(), ctx(deck.id))).status).toBe(200);

    expect(listQueue()).toHaveLength(0);
    expect(isQuarantined(deck.id)).toBe(false);
    expect(recordAudit).toHaveBeenCalledWith(
      "moderation.deleted_under_review",
      "Shared terms",
      "submitted",
    );
  });
});

describe("DELETE /api/quizzes/[id]", () => {
  it("takes the quiz's queue entries with it and records the deletion", async () => {
    const quiz = createQuiz("Cardiology basics", [], ME);
    hold(quiz.id, {
      kind: "quiz",
      title: "Cardiology basics",
      reason: "reported",
      reportedBy: "bea",
      categories: [],
    });

    expect((await quizDelete(req(), ctx(quiz.id))).status).toBe(200);

    expect(listQueue()).toHaveLength(0);
    expect(isQuarantined(quiz.id)).toBe(false);
    expect(recordAudit).toHaveBeenCalledWith(
      "moderation.deleted_under_review",
      "Cardiology basics",
      "reported by bea",
    );
  });
});
