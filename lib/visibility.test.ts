import { describe, expect, it } from "vitest";

import {
  MAX_PEOPLE,
  type Scoped,
  type Viewer,
  canEdit,
  canManageSharing,
  canView,
  filterScoped,
  normalizePeople,
  normalizeVisibility,
} from "./visibility";

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

describe("people grants (Google-Docs-style sharing)", () => {
  const sharedViewer: Scoped = {
    visibility: "private", chapter: "Vancouver", owner: "someone",
    people: [{ person: "you", role: "viewer" }],
  };
  const sharedEditor: Scoped = {
    visibility: "private", chapter: "Vancouver", owner: "someone",
    people: [{ person: "you", role: "editor" }],
  };

  it("a person grant opens a private resource to that person", () => {
    expect(canView(sharedViewer, viewer)).toBe(true);
    expect(canView(sharedEditor, viewer)).toBe(true);
  });
  it("a person grant is per-person, not per-chapter", () => {
    const other: Viewer = { owner: "someone-else", chapter: "Toronto Central", admin: false };
    expect(canView(sharedViewer, other)).toBe(false);
  });
  it("canEdit: owner and admin always; editor grant yes; viewer grant no", () => {
    expect(canEdit(mine, viewer)).toBe(true);
    expect(canEdit(theirs, admin)).toBe(true);
    expect(canEdit(sharedEditor, viewer)).toBe(true);
    expect(canEdit(sharedViewer, viewer)).toBe(false);
    expect(canEdit(theirs, viewer)).toBe(false);
  });
  it("canManageSharing: owner/admin only — an editor grant does NOT let you re-share", () => {
    expect(canManageSharing(mine, viewer)).toBe(true);
    expect(canManageSharing(theirs, admin)).toBe(true);
    // The key least-privilege property: an editor can edit content but cannot
    // change who can see the resource.
    expect(canEdit(sharedEditor, viewer)).toBe(true);
    expect(canManageSharing(sharedEditor, viewer)).toBe(false);
    expect(canManageSharing(sharedViewer, viewer)).toBe(false);
  });
});

describe("normalizePeople", () => {
  it("rejects non-arrays and junk entries", () => {
    expect(normalizePeople("nope")).toEqual([]);
    expect(normalizePeople([null, 42, "str", {}])).toEqual([]);
  });
  it("trims, defaults bad roles to viewer, and dedupes with last-wins", () => {
    expect(
      normalizePeople([
        { person: "  Ava ", role: "editor" },
        { person: "Ava", role: "viewer" },
        { person: "Ben", role: "admin" },
      ]),
    ).toEqual([
      { person: "Ava", role: "viewer" },
      { person: "Ben", role: "viewer" },
    ]);
  });
  it("drops the owner (they already have full access)", () => {
    expect(normalizePeople([{ person: "you", role: "editor" }], "you")).toEqual([]);
  });
  it("caps the list at MAX_PEOPLE", () => {
    const many = Array.from({ length: MAX_PEOPLE + 5 }, (_, i) => ({ person: `p${i}`, role: "viewer" }));
    expect(normalizePeople(many)).toHaveLength(MAX_PEOPLE);
  });
});

describe("normalizeVisibility", () => {
  it("defaults unknown values to public", () => {
    expect(normalizeVisibility("nonsense")).toBe("public");
    expect(normalizeVisibility("chapter")).toBe("chapter");
    expect(normalizeVisibility("private")).toBe("private");
  });
});
