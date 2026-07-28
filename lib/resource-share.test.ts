import { describe, expect, it } from "vitest";

import { deleteShare, getShare, setShare } from "./resource-share";

describe("resource share sidecar", () => {
  it("is empty for an unshared doc", () => {
    expect(getShare("u_unshared")).toBeUndefined();
  });

  it("records and reads back a share state", () => {
    setShare("u_a", { visibility: "public", chapter: "" });
    expect(getShare("u_a")).toEqual({ visibility: "public", chapter: "", people: [] });
  });

  it("clamps an overlong chapter", () => {
    setShare("u_b", { visibility: "chapter", chapter: "x".repeat(200) });
    expect(getShare("u_b")!.chapter.length).toBe(80);
  });

  it("merges partial patches - a scope change preserves the people list", () => {
    setShare("u_c", { people: [{ person: "Ava", role: "editor" }] });
    setShare("u_c", { visibility: "chapter", chapter: "Toronto Central" });
    expect(getShare("u_c")).toEqual({
      visibility: "chapter",
      chapter: "Toronto Central",
      people: [{ person: "Ava", role: "editor" }],
    });
  });

  it("merges partial patches - a people change preserves the scope", () => {
    setShare("u_d", { visibility: "private", chapter: "" });
    setShare("u_d", { people: [{ person: "Ben", role: "viewer" }] });
    expect(getShare("u_d")!.visibility).toBe("private");
    expect(getShare("u_d")!.people).toEqual([{ person: "Ben", role: "viewer" }]);
  });

  it("seeds defaults on first write so a people-only patch doesn't invent a scope", () => {
    setShare("u_e", { people: [] }, { visibility: "private", chapter: "TC" });
    expect(getShare("u_e")).toEqual({ visibility: "private", chapter: "TC", people: [] });
  });

  it("keeps a name override across unrelated patches", () => {
    setShare("u_f", { name: "Renamed.pdf" });
    setShare("u_f", { visibility: "public" });
    expect(getShare("u_f")!.name).toBe("Renamed.pdf");
  });

  it("normalizes an untrusted people patch", () => {
    setShare("u_g", { people: [{ person: "  Cam  ", role: "owner" as never }, null as never] });
    expect(getShare("u_g")!.people).toEqual([{ person: "Cam", role: "viewer" }]);
  });

  it("deleteShare drops the entry", () => {
    setShare("u_h", { visibility: "public" });
    deleteShare("u_h");
    expect(getShare("u_h")).toBeUndefined();
  });
});
