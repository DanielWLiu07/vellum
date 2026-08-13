import { describe, expect, it } from "vitest";

import {
  MAX_PEOPLE,
  type DirectoryMember,
  type Scoped,
  type Viewer,
  candidateMembers,
  canEdit,
  canManageSharing,
  canView,
  chapterLabel,
  filterScoped,
  makeNameResolver,
  memberName,
  normalizePeople,
  normalizeVisibility,
  resolveGrants,
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

describe("resolveGrants", () => {
  const directory: DirectoryMember[] = [
    { id: "usr_ava", name: "Ava Chen" },
    { id: "usr_ben", name: "Ben Diaz" },
  ];

  it("shows the member's name while the grant keeps the id", () => {
    expect(resolveGrants([{ person: "usr_ava", role: "editor" }], directory)).toEqual([
      { person: "usr_ava", role: "editor", label: "Ava Chen", known: true },
    ]);
  });

  it("keeps an id the directory doesn't cover, flagged rather than dropped", () => {
    // This is the shape of a grant the old free-text box wrote. The owner has
    // to be able to see it to remove it, so it survives resolution.
    expect(resolveGrants([{ person: "Jane Smith", role: "viewer" }], directory)).toEqual([
      { person: "Jane Smith", role: "viewer", label: "Jane Smith", known: false },
    ]);
  });

  it("falls back to the id when the directory has the member but no usable name", () => {
    const nameless: DirectoryMember[] = [{ id: "usr_ghost", name: "   " }];
    expect(resolveGrants([{ person: "usr_ghost", role: "viewer" }], nameless)).toEqual([
      // known stays true: the id resolves, there is just nothing to print.
      { person: "usr_ghost", role: "viewer", label: "usr_ghost", known: true },
    ]);
  });

  it("handles a resource with no grants at all", () => {
    expect(resolveGrants(undefined, directory)).toEqual([]);
  });
});

describe("candidateMembers", () => {
  const roster: DirectoryMember[] = [
    { id: "usr_ava", name: "Ava Chen" },
    { id: "usr_ben", name: "Ben Diaz" },
    { id: "usr_cam", name: "Cam Ng" },
  ];

  it("matches on name, case-insensitively", () => {
    expect(candidateMembers(roster, "ch").map((m) => m.id)).toEqual(["usr_ava"]);
    expect(candidateMembers(roster, "AVA").map((m) => m.id)).toEqual(["usr_ava"]);
  });

  it("matches on id too, so a pasted id resolves", () => {
    expect(candidateMembers(roster, "usr_ben").map((m) => m.id)).toEqual(["usr_ben"]);
  });

  it("hides the owner and anyone already granted", () => {
    expect(
      candidateMembers(roster, "", { owner: "usr_ava", exclude: ["usr_ben"] }).map((m) => m.id),
    ).toEqual(["usr_cam"]);
  });

  it("drops a member with no id — it could not be stored as a working grant", () => {
    expect(candidateMembers([{ id: "", name: "Nobody" }], "").length).toBe(0);
  });

  it("preserves roster order rather than re-sorting", () => {
    // /api/roster already sorts by name (listKnownUsers); sorting again here
    // would be a second opinion that could disagree with the server's.
    const reversed = [...roster].reverse();
    expect(candidateMembers(reversed, "").map((m) => m.id)).toEqual(["usr_cam", "usr_ben", "usr_ava"]);
  });

  it("an empty query returns every addable member", () => {
    expect(candidateMembers(roster, "   ")).toHaveLength(3);
  });
});

describe("makeNameResolver", () => {
  const directory: DirectoryMember[] = [
    { id: "usr_ava", name: "Ava Chen" },
    { id: "usr_ben", name: "Ben Diaz" },
  ];

  it("names known ids and echoes unknown ones", () => {
    const resolve = makeNameResolver(directory);
    expect(resolve("usr_ava")).toBe("Ava Chen");
    expect(resolve("usr_ben")).toBe("Ben Diaz");
    // A member of another chapter is legitimately absent from a scoped roster,
    // so this must stay the id and never become an invented placeholder.
    expect(resolve("usr_elsewhere")).toBe("usr_elsewhere");
  });

  it("a blank name never overrides a real one", () => {
    // Order-dependence would otherwise let a nameless row blank out a byline.
    const resolve = makeNameResolver([...directory, { id: "usr_ava", name: "  " }]);
    expect(resolve("usr_ava")).toBe("Ava Chen");
  });

  it("a later real name wins, so a session can override a stale roster row", () => {
    const resolve = makeNameResolver([...directory, { id: "usr_ava", name: "Ava C." }]);
    expect(resolve("usr_ava")).toBe("Ava C.");
  });

  it("resolves an empty id to itself rather than to some member", () => {
    expect(makeNameResolver(directory)("")).toBe("");
  });
});

describe("memberName", () => {
  const directory: DirectoryMember[] = [{ id: "usr_ava", name: "Ava Chen" }];

  it("names a known id and echoes an unknown one", () => {
    expect(memberName("usr_ava", directory)).toBe("Ava Chen");
    expect(memberName("usr_nope", directory)).toBe("usr_nope");
  });

  it("lets a later entry override an earlier one", () => {
    // The dialog appends the signed-in session after the roster so your own
    // name comes from your session rather than from a stale roster row.
    expect(memberName("usr_ava", [...directory, { id: "usr_ava", name: "Ava C." }])).toBe("Ava C.");
  });
});

describe("chapterLabel", () => {
  const known = [
    { chapter: "chp_tor", chapterName: "Toronto Central" },
    { chapter: "chp_van", chapterName: "" },
  ];

  it("names a chapter it can resolve", () => {
    expect(chapterLabel("chp_tor", known)).toBe("Toronto Central");
  });

  it("falls back to the raw id rather than inventing a name", () => {
    // A cuid on screen reads as "don't touch this", which is the point — the
    // old editable box invited exactly the tidying that broke chapter scope.
    expect(chapterLabel("chp_van", known)).toBe("chp_van");
    expect(chapterLabel("chp_unknown", known)).toBe("chp_unknown");
  });

  it("has nothing to say about a resource with no chapter", () => {
    expect(chapterLabel("", known)).toBe("");
  });
});
