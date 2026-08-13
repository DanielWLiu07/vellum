// Liveness reporting for the moderation endpoint.
//
// `moderationConfigured()` only tests that a key is set, and it was the whole
// of the admin indicator. When the endpoint began answering 429, every call
// fail-opened, the gate quarantined everything as "unchecked", and the console
// still read "AI moderation: On — 0 items blocked": exactly what a healthy,
// quiet system looks like. These cover the difference between on and working.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { __resetModerationStats, moderateText, moderationHealth } from "./moderation";

const OK_BODY = { results: [{ flagged: false, categories: {} }] };

function mockFetch(impl: () => Promise<Response> | Response) {
  vi.stubGlobal("fetch", vi.fn(impl));
}

beforeEach(() => {
  __resetModerationStats();
  vi.stubEnv("OPENAI_API_KEY", "sk-test-key");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("moderationHealth", () => {
  it("is not degraded before any call has been made", () => {
    expect(moderationHealth()).toMatchObject({ configured: true, calls: 0, degraded: false });
  });

  it("stays healthy while calls succeed", async () => {
    mockFetch(() => new Response(JSON.stringify(OK_BODY), { status: 200 }));
    await moderateText("ECG interpretation guide");
    expect(moderationHealth()).toMatchObject({ calls: 1, failures: 0, degraded: false });
  });

  // The live failure: a valid key against a rate-limited account.
  it("reports degraded with the status when the endpoint refuses", async () => {
    mockFetch(() => new Response("{}", { status: 429 }));
    await moderateText("anything");
    expect(moderationHealth()).toMatchObject({
      configured: true,
      degraded: true,
      failures: 1,
      lastStatus: 429,
    });
  });

  it("reports degraded when the call never reaches a response", async () => {
    mockFetch(() => Promise.reject(new Error("ECONNRESET")));
    await moderateText("anything");
    const h = moderationHealth();
    expect(h.degraded).toBe(true);
    expect(h.lastStatus).toBeUndefined(); // no response, so no status to report
  });

  it("treats a 200 with no results as a failure, not a clean pass", async () => {
    mockFetch(() => new Response(JSON.stringify({ results: [] }), { status: 200 }));
    await moderateText("anything");
    expect(moderationHealth()).toMatchObject({ degraded: true, failures: 1 });
  });

  // Keyed on the LAST call: a blip an hour ago is not an outage now, and a
  // recovered endpoint must clear the warning without a restart.
  it("clears once calls get through again", async () => {
    mockFetch(() => new Response("{}", { status: 429 }));
    await moderateText("anything");
    expect(moderationHealth().degraded).toBe(true);

    mockFetch(() => new Response(JSON.stringify(OK_BODY), { status: 200 }));
    await moderateText("anything");
    const h = moderationHealth();
    expect(h.degraded).toBe(false);
    expect(h.failures).toBe(1); // the history is kept, the alarm is not
  });

  it("is never degraded with no key — that is off, not broken", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    mockFetch(() => new Response("{}", { status: 429 }));
    await moderateText("anything");
    expect(moderationHealth()).toMatchObject({ configured: false, degraded: false });
  });
});
