import { describe, expect, it } from "vitest";

import { scanCopyright } from "./copyright";

describe("scanCopyright", () => {
  it("passes a chapter's own handout (no third-party markers)", () => {
    const r = scanCopyright("ECG interpretation - study notes by the Toronto Central chapter");
    expect(r.flagged).toBe(false);
    expect(r.signals).toEqual([]);
  });

  it("does NOT flag a generic copyright notice on HOSA's own material", () => {
    // We deliberately don't block "(c) 2024 ... all rights reserved" style
    // notices, because HOSA's own official resources carry them.
    const r = scanCopyright("© 2027 HOSA Canada. Official competitive events handbook.");
    expect(r.flagged).toBe(false);
  });

  it("flags an ISBN (textbook scan)", () => {
    const r = scanCopyright("Anatomy & Physiology, 10th edition. ISBN: 978-0-13-394033-8");
    expect(r.flagged).toBe(true);
    expect(r.signals).toContain("ISBN");
  });

  it("flags a commercial publisher name", () => {
    const r = scanCopyright("Copyright Pearson Education. Chapter 4 review.");
    expect(r.flagged).toBe(true);
    expect(r.signals).toContain("pearson");
  });

  it("flags restricted-material phrases (test bank / instructor's manual)", () => {
    expect(scanCopyright("Instructor's Manual - not for student distribution").flagged).toBe(true);
    expect(scanCopyright("Chapter 3 TEST BANK").flagged).toBe(true);
    expect(scanCopyright("No part of this publication may be reproduced").flagged).toBe(true);
  });

  it("is case-insensitive and dedupes signals", () => {
    const r = scanCopyright("ELSEVIER elsevier Test Bank test bank");
    expect(r.signals.sort()).toEqual(['"test bank"', "elsevier"]);
  });
});
