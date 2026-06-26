import { describe, expect, it } from "vitest";

import { decodeClaimsUnsafe } from "./claims-client";

function token(payload: unknown): string {
  const b64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `v1.${b64}.signature-ignored-client-side`;
}

describe("decodeClaimsUnsafe", () => {
  it("reads the watermark and permissions from the payload", () => {
    const c = decodeClaimsUnsafe(token({ wm: "Daniel Liu", perms: { download: true, print: false, copy: true } }));
    expect(c).toEqual({ wm: "Daniel Liu", perms: { download: true, print: false, copy: true } });
  });

  it("decodes a UTF-8 watermark (bullet / accents) correctly", () => {
    const c = decodeClaimsUnsafe(token({ wm: "Élise • member@hosa.org", perms: {} }));
    expect(c?.wm).toBe("Élise • member@hosa.org");
  });

  it("defaults every permission to false when absent", () => {
    const c = decodeClaimsUnsafe(token({ wm: "x" }));
    expect(c?.perms).toEqual({ download: false, print: false, copy: false });
  });

  it("treats non-boolean permission values as false", () => {
    const c = decodeClaimsUnsafe(token({ wm: "x", perms: { download: "yes", print: 1 } }));
    expect(c?.perms).toEqual({ download: false, print: false, copy: false });
  });

  it("returns null on malformed input", () => {
    expect(decodeClaimsUnsafe("garbage")).toBeNull();
    expect(decodeClaimsUnsafe("v1..sig")).toBeNull();
  });
});
