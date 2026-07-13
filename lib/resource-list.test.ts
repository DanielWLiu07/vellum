import { describe, expect, it } from "vitest";

import { matchesQuery, sortDocs, type ResourceLike } from "./resource-list";

const doc = (over: Partial<ResourceLike>): ResourceLike => ({
  id: "1", name: "Doc", owner: "you", sizeBytes: 100, uploadedAt: 0, ...over,
});

const A = doc({ id: "a", name: "Anatomy basics", owner: "you", sizeBytes: 300, uploadedAt: 30, event: "Nutrition" });
const B = doc({ id: "b", name: "Biology 10", owner: "priya", sizeBytes: 100, uploadedAt: 10, event: "Anatomy" });
const C = doc({ id: "c", name: "Biology 2", owner: "marcus", sizeBytes: 200, uploadedAt: 20 }); // no event

describe("sortDocs", () => {
  it("does not mutate the input array", () => {
    const input = [A, B, C];
    sortDocs(input, "name-az");
    expect(input).toEqual([A, B, C]);
  });

  it("newest/oldest by uploadedAt", () => {
    expect(sortDocs([B, A, C], "newest").map((d) => d.id)).toEqual(["a", "c", "b"]);
    expect(sortDocs([B, A, C], "oldest").map((d) => d.id)).toEqual(["b", "c", "a"]);
  });

  it("name sort is numeric-aware (Biology 2 before Biology 10)", () => {
    expect(sortDocs([B, C], "name-az").map((d) => d.name)).toEqual(["Biology 2", "Biology 10"]);
  });

  it("largest/smallest by size", () => {
    expect(sortDocs([B, A, C], "largest").map((d) => d.id)).toEqual(["a", "c", "b"]);
    expect(sortDocs([A, B, C], "smallest").map((d) => d.id)).toEqual(["b", "c", "a"]);
  });

  it("most-saved uses countOf desc, tiebreak by name", () => {
    const counts: Record<string, number> = { a: 2, b: 2, c: 5 };
    // c (5) first; a and b tie at 2 -> name order (Anatomy before Biology)
    expect(sortDocs([A, B, C], "most-saved", (id) => counts[id] ?? 0).map((d) => d.id)).toEqual(["c", "a", "b"]);
  });

  it("most-saved defaults every count to 0 without a countOf", () => {
    // all tie at 0 -> pure name order (numeric: Biology 2 before Biology 10)
    expect(sortDocs([C, B, A], "most-saved").map((d) => d.name)).toEqual(["Anatomy basics", "Biology 2", "Biology 10"]);
  });

  it("by-event groups alphabetically, untagged last, name tiebreak", () => {
    // events: B=Anatomy, A=Nutrition, C=(none). Order: Anatomy, Nutrition, then untagged.
    expect(sortDocs([A, B, C], "event").map((d) => d.id)).toEqual(["b", "a", "c"]);
  });
});

describe("matchesQuery", () => {
  it("empty query matches everything", () => {
    expect(matchesQuery(A, "")).toBe(true);
    expect(matchesQuery(A, "   ")).toBe(true);
  });

  it("matches across name, owner, and event (case-insensitive)", () => {
    expect(matchesQuery(A, "anatomy")).toBe(true);   // name
    expect(matchesQuery(B, "PRIYA")).toBe(true);      // owner
    expect(matchesQuery(A, "nutrition")).toBe(true);  // event
  });

  it("requires ALL words to appear (any field)", () => {
    expect(matchesQuery(A, "anatomy basics")).toBe(true);
    expect(matchesQuery(A, "anatomy nutrition")).toBe(true); // one from name, one from event
    expect(matchesQuery(A, "anatomy chemistry")).toBe(false); // chemistry appears nowhere
  });

  it("tolerates extra whitespace between words", () => {
    expect(matchesQuery(A, "  anatomy    basics ")).toBe(true);
  });
});
