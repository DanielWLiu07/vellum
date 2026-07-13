import { beforeEach, describe, expect, it } from "vitest";

import {
  __resetResourceMeta,
  deleteResourceMeta,
  getResourceEvent,
  getResourceMeta,
  setResourceMeta,
} from "./resource-meta";

beforeEach(() => __resetResourceMeta());

describe("setResourceMeta", () => {
  it("starts empty", () => {
    expect(getResourceMeta("u_1")).toBeUndefined();
    expect(getResourceEvent("u_1")).toBeUndefined();
  });

  it("sets and trims the event, capping length", () => {
    setResourceMeta("u_1", { event: "  Medical Terminology  " });
    expect(getResourceEvent("u_1")).toBe("Medical Terminology");
    setResourceMeta("u_1", { event: "x".repeat(200) });
    expect(getResourceEvent("u_1")!.length).toBe(60);
  });

  it("an empty event clears the tag", () => {
    setResourceMeta("u_1", { event: "Nutrition" });
    setResourceMeta("u_1", { event: "   " });
    expect(getResourceEvent("u_1")).toBeUndefined();
  });

  it("merges fields (event and noPreview are independent)", () => {
    setResourceMeta("u_1", { event: "Pharmacology" });
    setResourceMeta("u_1", { noPreview: true });
    expect(getResourceMeta("u_1")).toEqual({ event: "Pharmacology", noPreview: true });
  });

  it("noPreview false clears the flag", () => {
    setResourceMeta("u_1", { noPreview: true });
    setResourceMeta("u_1", { noPreview: false });
    expect(getResourceMeta("u_1")).toEqual({});
  });

  it("tracks the official flag independently of event/noPreview", () => {
    setResourceMeta("u_1", { event: "Nutrition", official: true });
    expect(getResourceMeta("u_1")).toEqual({ event: "Nutrition", official: true });
    setResourceMeta("u_1", { official: false });
    expect(getResourceMeta("u_1")).toEqual({ event: "Nutrition" });
  });
});

describe("deleteResourceMeta", () => {
  it("removes the entry", () => {
    setResourceMeta("u_1", { event: "Nutrition", noPreview: true });
    deleteResourceMeta("u_1");
    expect(getResourceMeta("u_1")).toBeUndefined();
  });
});
