// The publish gate on quiz creation - the deck rules, applied to the other
// resource type that has a `public` scope. See app/api/decks/route.test.ts for
// why a member's public request is a submission rather than a setting.

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
import { __resetModerationQueue, listPending } from "@/lib/moderation-queue";
import { __resetProfile } from "@/lib/profile";
import { OWNER_KEY } from "@/lib/profile-types";
import { deleteQuiz, getQuiz } from "@/lib/quizzes";
import { __resetRateLimit } from "@/lib/rate-limit";
import { __resetShareBans, banPublicSharing } from "@/lib/share-ban";

const post = (body: unknown) =>
  POST(
    new NextRequest("https://v.test/api/quizzes", {
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

describe("POST /api/quizzes - publishing is a submission", () => {
  it("holds a member's public quiz private and files it for a reviewer", async () => {
    const res = await post({ title: "Pharm practice", questions: [], visibility: "public" });
    const body = await res.json();
    try {
      expect(body.visibility).toBe("private");
      expect(body.submittedForReview).toBe(true);
      expect(getQuiz(body.id)!.visibility).toBe("private");

      const pending = listPending();
      expect(pending).toHaveLength(1);
      expect(pending[0]).toMatchObject({
        resourceId: body.id,
        kind: "quiz",
        reason: "submitted",
        requestedVisibility: "public",
      });
    } finally {
      deleteQuiz(body.id);
    }
  });

  it("applies chapter immediately and queues nothing - your own classmates are your call", async () => {
    const res = await post({ title: "Chapter quiz", questions: [], visibility: "chapter" });
    const body = await res.json();
    try {
      expect(body.visibility).toBe("chapter");
      expect(body.submittedForReview).toBeUndefined();
      expect(listPending()).toHaveLength(0);
    } finally {
      deleteQuiz(body.id);
    }
  });

  it("clamps a banned member's chapter quiz to private with no actor passed anywhere", async () => {
    banPublicSharing(OWNER_KEY, "admin", "repeat copyright uploads");
    const res = await post({ title: "Banned member's quiz", questions: [], visibility: "chapter" });
    const body = await res.json();
    try {
      expect(body.visibility).toBe("private");
      expect(getQuiz(body.id)!.visibility).toBe("private");
    } finally {
      deleteQuiz(body.id);
    }
  });
});
