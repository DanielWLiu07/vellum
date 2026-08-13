import { describe, expect, it } from "vitest";

import { localDocId } from "./local-source";

const ORIGIN = "https://vitals.hosacanada.org";

describe("localDocId", () => {
  it("recognises our own document URL", () => {
    expect(localDocId(`${ORIGIN}/api/doc/u_abc123`, ORIGIN)).toBe("u_abc123");
  });

  it("works on localhost, where the dev handoff lives", () => {
    expect(localDocId("http://localhost:3000/api/doc/sample", "http://localhost:3000")).toBe("sample");
  });

  it("decodes an escaped id", () => {
    expect(localDocId(`${ORIGIN}/api/doc/a%20b`, ORIGIN)).toBe("a b");
  });

  // A prefix match would resolve /api/doc/<id>/preview to the id's full bytes,
  // handing back the whole document where a thumbnail was meant.
  it("does not match a sub-route of a document", () => {
    expect(localDocId(`${ORIGIN}/api/doc/u_abc/preview`, ORIGIN)).toBeNull();
    expect(localDocId(`${ORIGIN}/api/doc/u_abc/`, ORIGIN)).toBeNull();
  });

  it("does not match a different API path", () => {
    expect(localDocId(`${ORIGIN}/api/docs`, ORIGIN)).toBeNull();
    expect(localDocId(`${ORIGIN}/api/doc`, ORIGIN)).toBeNull();
  });

  // The whole point of the shortcut is that WE already hold the authority. A
  // foreign host's document is somebody else's, and must take the fetch path.
  it("refuses another host, even with the same path shape", () => {
    expect(localDocId("https://evil.example.com/api/doc/u_abc", ORIGIN)).toBeNull();
  });

  it("refuses a scheme downgrade on the same host", () => {
    expect(localDocId("http://vitals.hosacanada.org/api/doc/u_abc", ORIGIN)).toBeNull();
  });

  it("distinguishes a port", () => {
    expect(localDocId("http://localhost:4000/api/doc/x", "http://localhost:3000")).toBeNull();
  });

  it("returns null for unparseable input rather than throwing", () => {
    expect(localDocId("not a url", ORIGIN)).toBeNull();
    expect(localDocId(`${ORIGIN}/api/doc/x`, "not an origin")).toBeNull();
  });

  it("ignores a query string, which is not part of the id", () => {
    expect(localDocId(`${ORIGIN}/api/doc/u_abc?x=1`, ORIGIN)).toBe("u_abc");
  });
});
