// The rule these tests protect: an editor must never lose a save because the
// document got big. Before autosaveInit, every autosave set keepalive
// unconditionally, and the browser rejects a keepalive body over 64 KiB
// outright — so the documents the API explicitly allows were exactly the ones
// that could not be written.

import { describe, expect, it } from "vitest";

import { autosaveInit, bodyBytes, keepaliveFits, KEEPALIVE_BUDGET_BYTES } from "./autosave-request";
import { MAX_CARDS } from "./decks";
import { BODY_MAX, MAX_BLOCKS } from "./modules";
import { MAX_QUESTIONS } from "./quizzes";

const signal = () => new AbortController().signal;
// `{"x":"…"}` is 8 bytes of wrapper, so the padding is the target minus that
// - the point of these cases is to land exactly on the boundary.
const body = (bytes: number) => JSON.stringify({ x: "a".repeat(Math.max(0, bytes - 8)) });

describe("keepalive budget", () => {
  it("keeps keepalive for a body that fits", () => {
    const init = autosaveInit(body(1_000), signal());
    expect(init.keepalive).toBe(true);
  });

  it("drops keepalive rather than let the browser reject the save", () => {
    const big = body(KEEPALIVE_BUDGET_BYTES + 1);
    expect(keepaliveFits(big)).toBe(false);
    // Absent, not `false` — the flag is omitted entirely.
    expect("keepalive" in autosaveInit(big, signal())).toBe(false);
  });

  it("treats the budget as inclusive", () => {
    const exact = "x".repeat(KEEPALIVE_BUDGET_BYTES);
    expect(bodyBytes(exact)).toBe(KEEPALIVE_BUDGET_BYTES);
    expect(keepaliveFits(exact)).toBe(true);
    expect(keepaliveFits(exact + "x")).toBe(false);
  });

  it("counts UTF-8 bytes, not UTF-16 code units", () => {
    // A budget measured in `String.length` would call this comfortably small;
    // on the wire each of these characters is three bytes.
    const multibyte = "字".repeat(KEEPALIVE_BUDGET_BYTES / 2);
    expect(multibyte.length).toBeLessThan(KEEPALIVE_BUDGET_BYTES);
    expect(bodyBytes(multibyte)).toBeGreaterThan(KEEPALIVE_BUDGET_BYTES);
    expect(keepaliveFits(multibyte)).toBe(false);
  });

  it("stays under the spec's 64 KiB, which is shared across in-flight requests", () => {
    expect(KEEPALIVE_BUDGET_BYTES).toBeLessThan(64 * 1024);
  });
});

describe("the init itself", () => {
  it("is a JSON PATCH carrying the body and the abort signal", () => {
    const ctrl = new AbortController();
    const init = autosaveInit('{"title":"x"}', ctrl.signal);
    expect(init.method).toBe("PATCH");
    expect(init.headers).toEqual({ "Content-Type": "application/json" });
    expect(init.body).toBe('{"title":"x"}');
    expect(init.signal).toBe(ctrl.signal);
  });
});

// Each of these is a document the server accepts, at a field length real
// content actually runs to. Each one was unsavable. Sizes are asserted as well
// as the verdict, so a future change to the budget has to face the magnitude
// rather than just flipping a boolean.
describe("documents the API allows but keepalive refused to send", () => {
  it("a full deck of term/definition cards", () => {
    // MAX_CARDS at ~80 characters a side - a term and a one-line definition.
    const cards = Array.from({ length: MAX_CARDS }, (_, i) => ({
      id: `c${i}`,
      front: `Term ${i} `.padEnd(80, "x"),
      back: `Definition ${i} `.padEnd(80, "y"),
    }));
    const payload = JSON.stringify({ title: "Full deck", cards });
    expect(bodyBytes(payload)).toBeGreaterThan(90 * 1024);
    expect(keepaliveFits(payload)).toBe(false);
  });

  it("a full quiz of four-option questions", () => {
    // MAX_QUESTIONS at 200 characters a field - well under FIELD_MAX (500).
    const questions = Array.from({ length: MAX_QUESTIONS }, (_, i) => ({
      id: `q${i}`,
      prompt: `Question ${i}: `.padEnd(200, "p"),
      choices: Array.from({ length: 4 }, (_, c) => ({ text: `Option ${c}: `.padEnd(200, "o") })),
      correctIndex: 0,
    }));
    const payload = JSON.stringify({ title: "Full quiz", questions });
    expect(bodyBytes(payload)).toBeGreaterThan(100 * 1024);
    expect(keepaliveFits(payload)).toBe(false);
  });

  it("seven written-info blocks in one part, well inside MAX_BLOCKS", () => {
    const blocks = Array.from({ length: 7 }, (_, i) => ({ id: `b${i}`, kind: "info", body: "w".repeat(BODY_MAX) }));
    expect(blocks.length).toBeLessThan(MAX_BLOCKS);
    const sections = [{ id: "s", title: "Section 1", subsections: [{ id: "ss", title: "Part 1", blocks }] }];
    const payload = JSON.stringify({ title: "Notes", sections });
    // Over the browser's own 64 KiB cap, not just our budget.
    expect(bodyBytes(payload)).toBeGreaterThan(64 * 1024);
    expect(keepaliveFits(payload)).toBe(false);
  });
});
