import { describe, expect, it } from "vitest";

import { reportProblemError } from "./report-problem";

describe("reportProblemError", () => {
  it("distinguishes rate limiting from a real failure", () => {
    const limited = reportProblemError(429);
    // The whole point of the 429 branch: the member must not think their words
    // are gone, because a member who thinks that retypes and resends them -
    // straight into the same limit.
    expect(limited).not.toBe(reportProblemError(500));
    expect(limited.toLowerCase()).toContain("wait");
    expect(limited.toLowerCase()).toContain("still here");
  });

  it("blames the connection when there was no response at all", () => {
    expect(reportProblemError(null).toLowerCase()).toContain("connection");
  });

  it("tells a signed-out member to sign in", () => {
    expect(reportProblemError(401)).toBe(reportProblemError(403));
    expect(reportProblemError(401).toLowerCase()).toContain("signed in");
  });

  it("surfaces an unrecognised status so a report can be traced", () => {
    expect(reportProblemError(503)).toContain("503");
  });
});
