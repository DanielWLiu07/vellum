import { describe, expect, it } from "vitest";

import { isModerationBlock, listAudit, listModerationBlocks, recordAudit } from "./audit";

describe("audit log", () => {
  it("records newest-first with action, target, and an explicit actor", () => {
    recordAudit("document.upload", "notes.pdf", undefined, "member_42");
    const top = listAudit()[0]!;
    expect(top.action).toBe("document.upload");
    expect(top.target).toBe("notes.pdf");
    expect(top.actor).toBe("member_42");
    expect(top.at).toBeGreaterThan(0);
  });

  it("returns a copy, not the live array", () => {
    const a = listAudit();
    a.push({ id: "x", action: "x", target: "x", actor: "x", at: 0 });
    expect(listAudit().some((e) => e.id === "x")).toBe(false);
  });

  it("defaults the actor to the current viewer", () => {
    recordAudit("quiz.create", "Q");
    expect(listAudit()[0]!.actor).toBe("you");
  });

  it("stores an optional detail (flagged categories) when provided", () => {
    recordAudit("deck.blocked", "Bad deck", "violence, hate");
    expect(listAudit()[0]).toMatchObject({ action: "deck.blocked", target: "Bad deck", detail: "violence, hate" });
  });

  it("omits detail when it is an empty string", () => {
    recordAudit("quiz.create", "Q2", "");
    expect(listAudit()[0]!.detail).toBeUndefined();
  });

  it("caps the log at 500 events", () => {
    for (let i = 0; i < 560; i++) recordAudit("deck.create", `d${i}`);
    expect(listAudit().length).toBeLessThanOrEqual(500);
  });
});

describe("isModerationBlock", () => {
  it("true for any *.blocked action", () => {
    expect(isModerationBlock("deck.blocked")).toBe(true);
    expect(isModerationBlock("image.blocked")).toBe(true);
    expect(isModerationBlock("document.blocked")).toBe(true);
  });
  it("false for normal actions and near-misses", () => {
    expect(isModerationBlock("deck.create")).toBe(false);
    expect(isModerationBlock("blocked.deck")).toBe(false);
    expect(isModerationBlock("blocked")).toBe(false);
  });
});

describe("listModerationBlocks", () => {
  it("returns only the *.blocked events, carrying their detail", () => {
    recordAudit("image.blocked", "card image", "sexual");
    recordAudit("deck.create", "clean deck");
    const blocks = listModerationBlocks();
    expect(blocks.length).toBeGreaterThan(0);
    expect(blocks.every((e) => e.action.endsWith(".blocked"))).toBe(true);
    expect(blocks.find((e) => e.target === "card image")?.detail).toBe("sexual");
  });
});
