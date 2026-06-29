import { describe, expect, it } from "vitest";

import { getShare, setShare } from "./resource-share";

describe("resource share sidecar", () => {
  it("is empty for an unshared doc", () => {
    expect(getShare("u_unshared")).toBeUndefined();
  });

  it("records and reads back a share state", () => {
    setShare("u_a", { visibility: "public", chapter: "" });
    expect(getShare("u_a")).toEqual({ visibility: "public", chapter: "" });
  });

  it("clamps an overlong chapter", () => {
    setShare("u_b", { visibility: "chapter", chapter: "x".repeat(200) });
    expect(getShare("u_b")!.chapter.length).toBe(80);
  });
});
