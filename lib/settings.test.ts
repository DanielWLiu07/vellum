// Settings that actually do something.
//
// The old Settings pane was three switches in component state — they moved,
// nothing read them, a refresh put them back. The point of this module is that
// each setting has an enforcement point, so these cover the enforcement, not
// the storage.

import { beforeEach, describe, expect, it } from "vitest";

import {
  __resetSettings,
  canUpload,
  DEFAULT_SETTINGS,
  getSettings,
  resolveWatermark,
  updateSettings,
} from "./settings";

beforeEach(() => __resetSettings());

describe("defaults preserve today's behaviour", () => {
  // Introducing a settings store must not quietly change how the platform
  // works. An admin opts into a change; the migration doesn't make one.
  it("starts with student uploads allowed and no forced watermark", () => {
    expect(getSettings()).toEqual({ allowStudentUploads: true, requireWatermark: false });
    expect(DEFAULT_SETTINGS).toEqual(getSettings());
  });

  it("fills in a setting missing from an older snapshot", () => {
    updateSettings({ requireWatermark: true });
    // allowStudentUploads was never written, and must not come back undefined.
    expect(getSettings().allowStudentUploads).toBe(true);
  });

  it("ignores keys it doesn't recognise instead of storing them", () => {
    updateSettings({ nonsense: true } as unknown as Parameters<typeof updateSettings>[0]);
    expect(getSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it("ignores a non-boolean value rather than coercing it", () => {
    updateSettings({ allowStudentUploads: "no" as unknown as boolean });
    expect(getSettings().allowStudentUploads).toBe(true);
  });
});

describe("canUpload", () => {
  it("lets everyone upload by default", () => {
    for (const role of ["student", "trainer", "advisor", "admin"]) {
      expect(canUpload(role)).toBe(true);
    }
  });

  it("blocks only students when the setting is off", () => {
    updateSettings({ allowStudentUploads: false });
    expect(canUpload("student")).toBe(false);
    // Locking out the people who run chapters would be a foot-gun, not a control.
    expect(canUpload("trainer")).toBe(true);
    expect(canUpload("advisor")).toBe(true);
    expect(canUpload("admin")).toBe(true);
  });

  it("treats an unknown role as non-student, so nobody is locked out by a typo", () => {
    updateSettings({ allowStudentUploads: false });
    expect(canUpload("president")).toBe(true);
  });
});

describe("resolveWatermark", () => {
  it("returns nothing when none was asked for and none is required", () => {
    expect(resolveWatermark("", "hosa_1")).toBe("");
  });

  it("keeps an explicit watermark, required or not", () => {
    expect(resolveWatermark("Nina · confidential", "hosa_1")).toBe("Nina · confidential");
    updateSettings({ requireWatermark: true });
    expect(resolveWatermark("Nina · confidential", "hosa_1")).toBe("Nina · confidential");
  });

  it("stamps the sharer's identity when one is required and none was given", () => {
    updateSettings({ requireWatermark: true });
    expect(resolveWatermark("", "hosa_1")).toBe("hosa_1");
  });

  // Identifying text is the entire point; whitespace is not a watermark.
  it("treats a blank string as no watermark", () => {
    updateSettings({ requireWatermark: true });
    expect(resolveWatermark("   ", "hosa_1")).toBe("hosa_1");
  });

  it("falls back to a constant rather than an empty stamp for an unknown sharer", () => {
    updateSettings({ requireWatermark: true });
    expect(resolveWatermark("", "")).toBe("HOSA Vitals");
  });
});
