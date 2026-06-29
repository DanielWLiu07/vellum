import { describe, expect, it } from "vitest";

import { listAudit, recordAudit } from "./audit";

describe("audit log", () => {
  it("records newest-first with action, target, and actor", () => {
    recordAudit("document.upload", "notes.pdf", "1.2.3.4");
    const top = listAudit()[0]!;
    expect(top.action).toBe("document.upload");
    expect(top.target).toBe("notes.pdf");
    expect(top.actor).toBe("1.2.3.4");
    expect(top.at).toBeGreaterThan(0);
  });

  it("returns a copy, not the live array", () => {
    const a = listAudit();
    a.push({ id: "x", action: "x", target: "x", actor: "x", at: 0 });
    expect(listAudit().some((e) => e.id === "x")).toBe(false);
  });
});
