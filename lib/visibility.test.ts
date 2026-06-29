import { describe, expect, it } from "vitest";

import { type Scoped, type Viewer, canView, filterScoped, normalizeVisibility } from "./visibility";

const viewer: Viewer = { owner: "you", chapter: "Toronto Central", admin: false };
const admin: Viewer = { owner: "root", chapter: "HQ", admin: true };

const pub: Scoped = { visibility: "public", chapter: "Other", owner: "someone" };
const myChapter: Scoped = { visibility: "chapter", chapter: "Toronto Central", owner: "someone" };
const otherChapter: Scoped = { visibility: "chapter", chapter: "Vancouver", owner: "someone" };
const mine: Scoped = { visibility: "private", chapter: "Toronto Central", owner: "you" };
const theirs: Scoped = { visibility: "private", chapter: "Toronto Central", owner: "someone" };

describe("canView", () => {
  it("public is visible to anyone", () => {
    expect(canView(pub, viewer)).toBe(true);
  });
  it("chapter is visible only within the same chapter", () => {
    expect(canView(myChapter, viewer)).toBe(true);
    expect(canView(otherChapter, viewer)).toBe(false);
  });
  it("private is visible only to its owner", () => {
    expect(canView(mine, viewer)).toBe(true);
    expect(canView(theirs, viewer)).toBe(false);
  });
  it("admin sees everything", () => {
    expect(canView(otherChapter, admin)).toBe(true);
    expect(canView(theirs, admin)).toBe(true);
  });
});

describe("filterScoped", () => {
  const all = [pub, myChapter, otherChapter, mine, theirs];
  it("accessible returns everything the viewer can see", () => {
    expect(filterScoped(all, viewer, "accessible")).toEqual([pub, myChapter, mine]);
  });
  it("public mode returns only public", () => {
    expect(filterScoped(all, viewer, "public")).toEqual([pub]);
  });
  it("chapter mode returns the viewer's chapter only", () => {
    expect(filterScoped(all, viewer, "chapter")).toEqual([myChapter, mine]);
  });
  it("mine mode returns the viewer's own", () => {
    expect(filterScoped(all, viewer, "mine")).toEqual([mine]);
  });
});

describe("normalizeVisibility", () => {
  it("defaults unknown values to public", () => {
    expect(normalizeVisibility("nonsense")).toBe("public");
    expect(normalizeVisibility("chapter")).toBe("chapter");
    expect(normalizeVisibility("private")).toBe("private");
  });
});
