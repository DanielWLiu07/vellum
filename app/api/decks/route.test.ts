// The publish gate on deck creation. `public` means every HOSA member in the
// country, so it is a submission a reviewer clears rather than a setting a
// member flips - the rule lib/publish states and documents have followed since
// it landed. Decks published instantly, so the same student got opposite
// answers to the same question depending on which kind of thing they shared.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/moderation", () => {
  const CLEAN = { allowed: true, flagged: false, categories: [], checked: true };
  return {
    moderateText: vi.fn().mockResolvedValue(CLEAN),
    moderateImage: vi.fn().mockResolvedValue(CLEAN),
    moderationConfigured: () => false,
    flaggedReason: (r: { categories: string[] }) => r.categories.join(", "),
  };
});

import { POST } from "./route";
import { deleteDeck, getDeck } from "@/lib/decks";
import { __resetModerationQueue, listPending } from "@/lib/moderation-queue";
import { __resetProfile } from "@/lib/profile";
import { OWNER_KEY } from "@/lib/profile-types";
import { __resetRateLimit } from "@/lib/rate-limit";
import { __resetShareBans, banPublicSharing } from "@/lib/share-ban";

const post = (body: unknown) =>
  POST(
    new NextRequest("https://v.test/api/decks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );

beforeEach(() => {
  process.env.VELLUM_DEMO_MODE = "1";
  __resetRateLimit();
  __resetProfile();
  __resetModerationQueue();
  __resetShareBans();
});
afterEach(() => {
  delete process.env.VELLUM_DEMO_MODE;
  __resetShareBans();
  vi.clearAllMocks();
});

describe("POST /api/decks - publishing is a submission", () => {
  it("holds a member's public deck private and files it for a reviewer", async () => {
    const res = await post({ title: "Cardio drills", cards: [], visibility: "public" });
    const body = await res.json();
    try {
      expect(body.visibility).toBe("private");
      expect(body.submittedForReview).toBe(true);
      expect(getDeck(body.id)!.visibility).toBe("private");

      // The member is owed an answer, so the request has to be somewhere a
      // reviewer will see it. Held-without-a-queue-entry is just a deck that
      // silently never publishes.
      const pending = listPending();
      expect(pending).toHaveLength(1);
      expect(pending[0]).toMatchObject({
        resourceId: body.id,
        kind: "deck",
        reason: "submitted",
        requestedVisibility: "public",
      });
    } finally {
      deleteDeck(body.id);
    }
  });

  it("applies chapter immediately and queues nothing - your own classmates are your call", async () => {
    const res = await post({ title: "Chapter set", cards: [], visibility: "chapter" });
    const body = await res.json();
    try {
      expect(body.visibility).toBe("chapter");
      expect(body.submittedForReview).toBeUndefined();
      expect(listPending()).toHaveLength(0);
    } finally {
      deleteDeck(body.id);
    }
  });

  // The create route names no actor when it writes share state, and it must not
  // have to: a ban that only holds where someone remembered to mention it is a
  // ban that holds nowhere. Chapter rather than public, so the clamp is what is
  // being measured and not the publish gate, which would hold a public request
  // for review regardless.
  it("clamps a banned member's chapter deck to private with no actor passed anywhere", async () => {
    banPublicSharing(OWNER_KEY, "admin", "repeat copyright uploads");
    const res = await post({ title: "Banned member's deck", cards: [], visibility: "chapter" });
    const body = await res.json();
    try {
      expect(body.visibility).toBe("private");
      expect(getDeck(body.id)!.visibility).toBe("private");
    } finally {
      deleteDeck(body.id);
    }
  });
});
