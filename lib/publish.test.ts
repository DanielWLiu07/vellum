import { describe, expect, it } from "vitest";

import { decidePublish, isPosted, resolvePublish } from "./publish";

describe("decidePublish", () => {
  it.each(["private", "chapter"] as const)("applies %s straight away — the member's own call", (requested) => {
    expect(decidePublish({ requested, current: "private", isAdmin: false })).toEqual({
      kind: "apply",
      visibility: requested,
    });
  });

  it("holds a member's public request for review", () => {
    expect(decidePublish({ requested: "public", current: "private", isAdmin: false })).toEqual({
      kind: "submit",
      hold: "private",
    });
  });

  // The detail that keeps people asking: requesting a wider audience must not
  // cost the audience already granted.
  it("holds at the CURRENT visibility, so asking never removes access", () => {
    expect(decidePublish({ requested: "public", current: "chapter", isAdmin: false })).toEqual({
      kind: "submit",
      hold: "chapter",
    });
  });

  it("lets an admin publish directly — they are the approver", () => {
    expect(decidePublish({ requested: "public", current: "private", isAdmin: true })).toEqual({
      kind: "apply",
      visibility: "public",
    });
  });

  it("lets anyone pull their own resource back to private without asking", () => {
    expect(decidePublish({ requested: "private", current: "public", isAdmin: false })).toEqual({
      kind: "apply",
      visibility: "private",
    });
  });

  it("does not re-queue a resource that is already public", () => {
    // Already live and re-saved (e.g. a rename): nothing to approve again.
    expect(decidePublish({ requested: "public", current: "public", isAdmin: false })).toEqual({
      kind: "submit",
      hold: "public",
    });
  });
});

describe("resolvePublish", () => {
  // The flattened form is what the deck and quiz routes store from, so the
  // thing worth pinning is that "submit" never leaks out as a visibility a
  // route might write: what comes back is always safe to save as-is.
  it("returns the hold, not the request, when a member asks to publish", () => {
    expect(resolvePublish({ requested: "public", current: "chapter", isAdmin: false })).toEqual({
      visibility: "chapter",
      submitted: true,
    });
  });

  it("returns the request itself when nothing needs approving", () => {
    expect(resolvePublish({ requested: "chapter", current: "private", isAdmin: false })).toEqual({
      visibility: "chapter",
      submitted: false,
    });
  });

  it("marks an admin's publish as applied, not submitted", () => {
    expect(resolvePublish({ requested: "public", current: "private", isAdmin: true })).toEqual({
      visibility: "public",
      submitted: false,
    });
  });

  // A create has no audience yet, so its routes pass current: "private". Worth
  // stating: holding a brand-new resource costs its owner nothing, which is why
  // the create path can hold without the "asking took something away" problem.
  it("holds a brand-new resource at private when its creator asks for public", () => {
    expect(resolvePublish({ requested: "public", current: "private", isAdmin: false })).toEqual({
      visibility: "private",
      submitted: true,
    });
  });
});

describe("isPosted", () => {
  it("counts only public as live to the organisation", () => {
    expect(isPosted("public")).toBe(true);
    expect(isPosted("chapter")).toBe(false);
    expect(isPosted("private")).toBe(false);
  });
});
