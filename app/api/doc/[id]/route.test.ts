import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";

import { DELETE } from "./route";
import { addUpload, getDoc } from "@/lib/store";

const bytes = (n = 4) => new Uint8Array(n).fill(0x25);
const req = () => new NextRequest("https://vellum.test/api/doc/x", { method: "DELETE" });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  process.env.VELLUM_DEMO_MODE = "1";
});
afterEach(() => {
  delete process.env.VELLUM_DEMO_MODE;
});

describe("DELETE /api/doc/[id]", () => {
  it("404s when the dashboard is disabled", async () => {
    delete process.env.VELLUM_DEMO_MODE;
    const res = await DELETE(req(), ctx("sample"));
    expect(res.status).toBe(404);
  });

  it("deletes an uploaded document", async () => {
    const m = await addUpload("notes.pdf", bytes());
    const res = await DELETE(req(), ctx(m.id));
    expect(res.status).toBe(200);
    expect(await getDoc(m.id)).toBeUndefined();
  });

  it("404s for a bundled sample (immutable) and leaves it intact", async () => {
    const res = await DELETE(req(), ctx("sample"));
    expect(res.status).toBe(404);
    expect(await getDoc("sample")).toBeDefined();
  });

  it("404s for a missing id", async () => {
    const res = await DELETE(req(), ctx("u_nope"));
    expect(res.status).toBe(404);
  });
});
