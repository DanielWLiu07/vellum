import { describe, expect, it } from "vitest";

import { ACTIVE_WINDOW_MS, type CountableMember, deriveAdminStats, statTiles } from "./admin-stats";

const NOW = 1_700_000_000_000;
const ago = (ms: number) => NOW - ms;

const member = (over: Partial<CountableMember> = {}): CountableMember => ({
  chapter: "chp_a",
  role: "student",
  lastSeenAt: ago(1000),
  ...over,
});

describe("deriveAdminStats", () => {
  it("counts an empty roster as zeroes rather than failing", () => {
    expect(deriveAdminStats([], 0, NOW)).toEqual({
      members: 0,
      students: 0,
      trainers: 0,
      advisors: 0,
      admins: 0,
      chapters: 0,
      documents: 0,
      activeRecently: 0,
    });
  });

  it("tallies each role", () => {
    const s = deriveAdminStats(
      [
        member({ role: "student" }),
        member({ role: "student" }),
        member({ role: "trainer" }),
        member({ role: "advisor" }),
        member({ role: "admin" }),
      ],
      0,
      NOW,
    );
    expect(s).toMatchObject({ members: 5, students: 2, trainers: 1, advisors: 1, admins: 1 });
  });

  it("ignores a role it does not recognise instead of miscounting it", () => {
    const s = deriveAdminStats([member({ role: "president" })], 0, NOW);
    expect(s.members).toBe(1);
    expect(s.students + s.trainers + s.advisors + s.admins).toBe(0);
  });

  it("counts distinct chapters, not members", () => {
    const s = deriveAdminStats(
      [member({ chapter: "chp_a" }), member({ chapter: "chp_a" }), member({ chapter: "chp_b" })],
      0,
      NOW,
    );
    expect(s.chapters).toBe(2);
  });

  // An admin carries no chapter, and a token minted before chapterName existed
  // can carry an empty one. "" is not a chapter.
  it("does not let a blank chapter inflate the chapter count", () => {
    const s = deriveAdminStats([member({ chapter: "" }), member({ chapter: "chp_a" })], 0, NOW);
    expect(s.chapters).toBe(1);
  });

  describe("activity window", () => {
    it("counts a member seen inside the window", () => {
      expect(deriveAdminStats([member({ lastSeenAt: ago(ACTIVE_WINDOW_MS - 1) })], 0, NOW).activeRecently).toBe(1);
    });

    it("includes the exact boundary", () => {
      expect(deriveAdminStats([member({ lastSeenAt: ago(ACTIVE_WINDOW_MS) })], 0, NOW).activeRecently).toBe(1);
    });

    it("excludes a member seen before it", () => {
      expect(deriveAdminStats([member({ lastSeenAt: ago(ACTIVE_WINDOW_MS + 1) })], 0, NOW).activeRecently).toBe(0);
    });

    // A reduced roster omits lastSeenAt. Absent is "not reported", not "idle" —
    // counting it either way would be inventing data.
    it("does not count a member whose last-seen was not reported", () => {
      expect(deriveAdminStats([member({ lastSeenAt: undefined })], 0, NOW).activeRecently).toBe(0);
    });

    it("does not count a clock-skewed future timestamp as stale", () => {
      expect(deriveAdminStats([member({ lastSeenAt: NOW + 60_000 })], 0, NOW).activeRecently).toBe(1);
    });
  });

  it("passes the document count straight through", () => {
    expect(deriveAdminStats([], 42, NOW).documents).toBe(42);
  });
});

describe("statTiles", () => {
  it("labels every derived figure exactly once", () => {
    const stats = deriveAdminStats([member(), member({ role: "trainer" })], 7, NOW);
    const tiles = statTiles(stats);
    expect(tiles.map((t) => t.label)).toEqual([
      "Members",
      "Active this week",
      "Chapters",
      "Documents",
      "Students",
      "Trainers",
      "Advisors",
      "Admins",
    ]);
    expect(new Set(tiles.map((t) => t.label)).size).toBe(tiles.length);
  });

  it("reports the values it was given, with nothing hardcoded", () => {
    const tiles = statTiles(deriveAdminStats([member(), member({ chapter: "chp_b" })], 3, NOW));
    expect(tiles.find((t) => t.label === "Members")?.value).toBe(2);
    expect(tiles.find((t) => t.label === "Chapters")?.value).toBe(2);
    expect(tiles.find((t) => t.label === "Documents")?.value).toBe(3);
  });
});
