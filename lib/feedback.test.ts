// Feedback, and the content a report is about.
//
// The rule the whole target feature bends around: the message is the report.
// Attaching it to a module is what makes a pile of reports triageable, but a
// student who hits a UI bug while filing must still be heard, so every way a
// target can be wrong ends in "filed as a general report", never in a rejection
// and never in a target an admin can't identify.

import { beforeEach, describe, expect, it } from "vitest";

import {
  __resetFeedback,
  isFeedbackTargetKind,
  listFeedback,
  listFeedbackFor,
  normalizeTarget,
  setResolved,
  submitFeedback,
  type Feedback,
  type FeedbackTarget,
} from "./feedback";

beforeEach(() => __resetFeedback());

const file = (message: string, target?: unknown) =>
  submitFeedback({ kind: "bug", message, target, reporter: "you" });

const MODULE: FeedbackTarget = { kind: "module", id: "mod_cpr", title: "CPR Basics" };

describe("filing a report against content", () => {
  it("round-trips a target through the stored report", () => {
    const item = file("Slide 4 contradicts slide 6.", MODULE)!;
    expect(item.target).toEqual(MODULE);
    expect(listFeedback()[0]!.target).toEqual(MODULE);
  });

  it("keeps a 1-based question number for a quiz", () => {
    const item = file("Answer key is wrong.", { kind: "quiz", id: "qz_1", title: "Vitals Quiz", question: 7 })!;
    expect(item.target).toEqual({ kind: "quiz", id: "qz_1", title: "Vitals Quiz", question: 7 });
  });

  it("still files a general report when no target is given", () => {
    // The pre-existing path: a report about the platform, not about one thing.
    const item = file("Search is slow.")!;
    expect(item.target).toBeUndefined();
    expect(item.message).toBe("Search is slow.");
  });
});

describe("a malformed target never costs the student their message", () => {
  // Each of these is a report that WOULD have been lost to a 400. It files.
  const bad: [name: string, target: unknown][] = [
    ["an unknown kind", { kind: "chapter", id: "c_1", title: "Toronto" }],
    ["a missing kind", { id: "mod_cpr", title: "CPR Basics" }],
    ["a missing id", { kind: "module", title: "CPR Basics" }],
    ["a whitespace-only id", { kind: "module", id: "   ", title: "CPR Basics" }],
    ["a missing title", { kind: "module", id: "mod_cpr" }],
    ["a whitespace-only title", { kind: "module", id: "mod_cpr", title: "  " }],
    ["a target that isn't an object", "mod_cpr"],
    ["null", null],
  ];

  for (const [name, target] of bad) {
    it(`drops ${name} and files the report anyway`, () => {
      const item = file("The video never loads.", target)!;
      expect(item).not.toBeNull();
      expect(item.message).toBe("The video never loads.");
      expect(item.target).toBeUndefined();
    });
  }

  it("drops the target rather than storing an id an admin cannot resolve", () => {
    // A blank title leaves a dangling id: the module can be renamed or deleted
    // later, and then nothing in the report says what it was about.
    expect(normalizeTarget({ kind: "module", id: "mod_cpr", title: "" })).toBeUndefined();
  });

  it("rejects an empty message with or without a valid target", () => {
    // Target support must not turn an empty submission into a filed report.
    expect(file("   ", MODULE)).toBeNull();
    expect(listFeedback()).toHaveLength(0);
  });
});

describe("clamping", () => {
  it("trims and caps a long id and title the way it caps a message", () => {
    const target = normalizeTarget({
      kind: "doc",
      id: `  ${"i".repeat(400)}  `,
      title: `  ${"t".repeat(400)}  `,
    })!;
    expect(target.id).toBe("i".repeat(200));
    expect(target.title).toBe("t".repeat(200));
  });

  it("keeps a question only for a quiz", () => {
    // A question number on a module is noise an admin would try to act on.
    expect(normalizeTarget({ ...MODULE, question: 3 })).toEqual(MODULE);
  });

  it("drops a question that isn't a whole number in range, keeping the target", () => {
    // Deliberately dropped rather than clamped: rounding 0 or 4.5 to a real
    // question would send the admin to a question nobody reported.
    for (const question of [0, -3, 4.5, 1000, NaN, Infinity, "seven", null]) {
      const target = normalizeTarget({ kind: "quiz", id: "qz_1", title: "Vitals Quiz", question });
      expect(target).toEqual({ kind: "quiz", id: "qz_1", title: "Vitals Quiz" });
    }
  });

  it("accepts the boundary question numbers and a numeric string", () => {
    const q = (question: unknown) =>
      normalizeTarget({ kind: "quiz", id: "qz_1", title: "Vitals Quiz", question })?.question;
    expect(q(1)).toBe(1);
    expect(q(999)).toBe(999);
    expect(q("7")).toBe(7); // JSON bodies routinely carry numbers as strings
  });
});

describe("listFeedbackFor", () => {
  it("returns only the reports against that one piece of content, newest first", () => {
    file("first complaint", MODULE);
    file("about a different module", { kind: "module", id: "mod_burns", title: "Burns" });
    file("second complaint", MODULE);

    const rows = listFeedbackFor("module", "mod_cpr");
    expect(rows.map((f) => f.message)).toEqual(["second complaint", "first complaint"]);
  });

  it("does not match the same id under a different kind", () => {
    // Ids are only unique within a kind; module "x" and doc "x" are unrelated.
    file("module report", { kind: "module", id: "shared_1", title: "M" });
    file("doc report", { kind: "doc", id: "shared_1", title: "D" });
    expect(listFeedbackFor("doc", "shared_1").map((f) => f.message)).toEqual(["doc report"]);
  });

  it("finds a report when the queried id has stray whitespace", () => {
    // Clamped identically on the read, so an admin pasting an id still matches.
    file("padded lookup", MODULE);
    expect(listFeedbackFor("module", "  mod_cpr  ")).toHaveLength(1);
  });

  it("matches nothing for a blank id instead of everything", () => {
    // A filter that quietly widens reads as "no other reports exist about this".
    file("some report", MODULE);
    expect(listFeedbackFor("module", "")).toEqual([]);
    expect(listFeedbackFor("module", "   ")).toEqual([]);
  });

  it("ignores general reports, which belong to no content", () => {
    file("general report");
    file("targeted report", MODULE);
    expect(listFeedbackFor("module", "mod_cpr").map((f) => f.message)).toEqual(["targeted report"]);
  });
});

describe("reports filed before targets existed", () => {
  // Snapshots written before this feature have no `target` key at all. Seed the
  // store the way the hydrator does (it pushes the snapshot straight in) so the
  // rows under test are genuinely target-less, not just missing a value.
  const seedLegacy = () => {
    const store = (globalThis as unknown as { __vitalsFeedback: Feedback[] }).__vitalsFeedback;
    store.push({ id: "fb_legacy", kind: "bug", message: "old report", reporter: "you", at: 1, resolved: false });
  };

  it("still lists a legacy report", () => {
    seedLegacy();
    expect(listFeedback().map((f) => f.id)).toContain("fb_legacy");
  });

  it("skips it when filtering by content instead of throwing on the missing target", () => {
    seedLegacy();
    file("targeted report", MODULE);
    expect(listFeedbackFor("module", "mod_cpr").map((f) => f.message)).toEqual(["targeted report"]);
  });

  it("lets a legacy report be resolved as before", () => {
    seedLegacy();
    expect(setResolved("fb_legacy", true)?.resolved).toBe(true);
  });
});

describe("isFeedbackTargetKind", () => {
  it("accepts the three content kinds and nothing else", () => {
    for (const kind of ["module", "doc", "quiz"]) expect(isFeedbackTargetKind(kind)).toBe(true);
    // Guards the ?targetKind= query param, which is raw user input.
    for (const kind of ["chapter", "", "MODULE", null, 3]) expect(isFeedbackTargetKind(kind)).toBe(false);
  });
});
