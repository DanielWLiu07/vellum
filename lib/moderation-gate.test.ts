import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { disposition, holdlessDisposition, strictest, type Disposition } from "./moderation-gate";
import type { ModerationResult } from "./moderation";

const CLEAN: ModerationResult = { allowed: true, flagged: false, categories: [], checked: true };
const SKIPPED: ModerationResult = { allowed: true, flagged: false, categories: [], checked: false };
const flaggedWith = (...categories: string[]): ModerationResult => ({
  allowed: false,
  flagged: true,
  categories,
  checked: true,
});

let priorKey: string | undefined;
beforeEach(() => {
  priorKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-key-at-least-16-chars";
});
afterEach(() => {
  if (priorKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = priorKey;
});

describe("disposition", () => {
  it("allows everything when no key is configured - the feature is opt-in", () => {
    delete process.env.OPENAI_API_KEY;
    expect(disposition(SKIPPED)).toEqual({ action: "allow" });
    expect(disposition(flaggedWith("violence"))).toEqual({ action: "allow" });
  });

  it("allows content that was actually examined and came back clean", () => {
    expect(disposition(CLEAN)).toEqual({ action: "allow" });
  });

  it("quarantines a soft flag rather than destroying it", () => {
    expect(disposition(flaggedWith("violence", "hate"))).toEqual({
      action: "quarantine",
      reason: "flagged",
      categories: ["violence", "hate"],
    });
  });

  it("refuses outright on a hard category, which has no review path", () => {
    expect(disposition(flaggedWith("sexual/minors"))).toEqual({
      action: "refuse",
      categories: ["sexual/minors"],
    });
  });

  it("refuses when a hard category rides along with soft ones", () => {
    const d = disposition(flaggedWith("violence", "sexual/minors"));
    expect(d.action).toBe("refuse");
  });

  it("quarantines an unchecked result instead of passing it as clean (the silent-pass fix)", () => {
    expect(disposition(SKIPPED, "image not examined (12.0MB)")).toEqual({
      action: "quarantine",
      reason: "unchecked",
      categories: [],
      detail: "image not examined (12.0MB)",
    });
  });

  it("omits detail when the caller has no explanation to give", () => {
    expect(disposition(SKIPPED)).toEqual({ action: "quarantine", reason: "unchecked", categories: [] });
  });
});

describe("holdlessDisposition", () => {
  it("allows examined, clean content", () => {
    expect(holdlessDisposition(CLEAN)).toEqual({ action: "allow" });
  });

  it("allows everything with no key, like the rest of the gate", () => {
    delete process.env.OPENAI_API_KEY;
    expect(holdlessDisposition(SKIPPED)).toEqual({ action: "allow" });
    expect(holdlessDisposition(flaggedWith("violence"))).toEqual({ action: "allow" });
  });

  // THE HOLE. moderateText returns allowed:true when it never ran, so the old
  // `if (!mod.allowed)` stored outage-era text as examined-and-cleared. The
  // OpenAI account is 429ing every call right now, so this was every comment,
  // folder name and profile edit being written today.
  it("refuses content nobody examined instead of passing it as clean", () => {
    expect(holdlessDisposition(SKIPPED)).toEqual({
      action: "refuse",
      reason: "unchecked",
      categories: [],
    });
  });

  // The reason has to survive the collapse: "we could not check this" and "a
  // model objected to this" call for different words to the member, and only
  // one of them is about anything they wrote.
  it("keeps flagged and unchecked apart so the caller can say which happened", () => {
    expect(holdlessDisposition(flaggedWith("violence"))).toEqual({
      action: "refuse",
      reason: "flagged",
      categories: ["violence"],
    });
    expect(holdlessDisposition(SKIPPED)).toMatchObject({ reason: "unchecked" });
  });

  // A hard category refuses everywhere. Same outcome as a soft flag here, but
  // the categories still travel so the audit line records which one it was.
  it("refuses a hard category as flagged, carrying the category through", () => {
    expect(holdlessDisposition(flaggedWith("sexual/minors"))).toEqual({
      action: "refuse",
      reason: "flagged",
      categories: ["sexual/minors"],
    });
  });

  // Nothing here may ever return a hold: the caller has no way to honour one,
  // and a queue entry for content that is already live is a decision a reviewer
  // cannot carry out.
  it("never asks the caller to quarantine", () => {
    for (const mod of [CLEAN, SKIPPED, flaggedWith("violence"), flaggedWith("sexual/minors")]) {
      expect(holdlessDisposition(mod).action).not.toBe("quarantine");
    }
  });
});

describe("strictest", () => {
  const allow: Disposition = { action: "allow" };
  const softHold: Disposition = { action: "quarantine", reason: "flagged", categories: ["violence"] };
  const gapHold: Disposition = { action: "quarantine", reason: "unchecked", categories: [] };
  const refusal: Disposition = { action: "refuse", categories: ["sexual/minors"] };

  it("is allow only when every check allows", () => {
    expect(strictest([allow, allow])).toEqual({ action: "allow" });
    expect(strictest([])).toEqual({ action: "allow" });
  });

  it("lets a refusal beat everything", () => {
    expect(strictest([allow, softHold, refusal]).action).toBe("refuse");
  });

  it("lets a hold beat an allow", () => {
    expect(strictest([allow, gapHold]).action).toBe("quarantine");
  });

  it("prefers the flagged reason over a coverage gap, so the reviewer sees the real cause", () => {
    const d = strictest([gapHold, softHold]);
    expect(d).toEqual({ action: "quarantine", reason: "flagged", categories: ["violence"] });
  });

  it("unions categories across several flagged holds without duplicates", () => {
    const other: Disposition = { action: "quarantine", reason: "flagged", categories: ["violence", "hate"] };
    const d = strictest([softHold, other]);
    expect(d.action).toBe("quarantine");
    expect((d as Extract<Disposition, { action: "quarantine" }>).categories).toEqual(["violence", "hate"]);
  });
});
