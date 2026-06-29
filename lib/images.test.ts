import { describe, expect, it } from "vitest";

import { getImage, putImage } from "./images";

describe("image store", () => {
  it("stores bytes + content type and reads them back by id", () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const id = putImage(bytes, "image/png");
    expect(id).toMatch(/^img_/);
    const got = getImage(id);
    expect(got?.contentType).toBe("image/png");
    expect(got?.bytes).toEqual(bytes);
  });

  it("returns undefined for an unknown id", () => {
    expect(getImage("img_nope")).toBeUndefined();
  });

  it("hands out distinct ids", () => {
    const a = putImage(new Uint8Array([0]), "image/jpeg");
    const b = putImage(new Uint8Array([0]), "image/jpeg");
    expect(a).not.toBe(b);
  });
});
