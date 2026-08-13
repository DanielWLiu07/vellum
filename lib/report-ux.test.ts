import { describe, expect, it } from "vitest";

import {
  MESSAGE_MAX,
  deckCardPart,
  reportMessage,
  reportMessageMax,
  reportSubject,
  reportTriggerAriaLabel,
  reportTriggerLabel,
  type ReportContext,
} from "./report-ux";

const module_: ReportContext = { target: { kind: "module", id: "mod_cpr", title: "CPR Basics" } };
const question: ReportContext = {
  target: { kind: "quiz", id: "qz_1", title: "Cardiology", question: 3 },
};
const card: ReportContext = { title: "Krebs cycle", part: deckCardPart(4, "Rate-limiting enzyme") };

describe("reportSubject", () => {
  it("names the whole thing when that is what is being reported", () => {
    expect(reportSubject(module_)).toBe("“CPR Basics”");
  });

  it("names the question, not just the quiz", () => {
    expect(reportSubject(question)).toBe("“Cardiology”, question 3");
  });

  it("names the card and the deck it came from", () => {
    expect(reportSubject(card)).toBe("“Krebs cycle”, card 4: “Rate-limiting enzyme”");
  });
});

describe("reportTriggerLabel", () => {
  it("scopes itself to the part it sits next to", () => {
    expect(reportTriggerLabel(question)).toBe("Report this question");
    expect(reportTriggerLabel(card)).toBe("Report this card");
  });

  it("falls back to the general wording when it reports the whole thing", () => {
    expect(reportTriggerLabel(module_)).toBe("Report a problem");
  });
});

describe("reportTriggerAriaLabel", () => {
  it("opens with the visible label", () => {
    // WCAG label-in-name. A speech-control user says what they can see, so the
    // accessible name has to start with it - the subject is extra, not instead.
    for (const ctx of [module_, question, card]) {
      expect(reportTriggerAriaLabel(ctx).startsWith(reportTriggerLabel(ctx))).toBe(true);
    }
  });

  it("tells twenty otherwise identical controls apart", () => {
    const q = (n: number): ReportContext => ({
      target: { kind: "quiz", id: "qz_1", title: "Cardiology", question: n },
    });
    expect(reportTriggerAriaLabel(q(3))).not.toBe(reportTriggerAriaLabel(q(4)));
  });
});

describe("deckCardPart", () => {
  it("keeps the front text on one line", () => {
    expect(deckCardPart(2, "  Sinoatrial\n node  ").label).toBe("2: “Sinoatrial node”");
  });

  it("cuts a front that is really a paragraph", () => {
    const label = deckCardPart(1, "word ".repeat(60)).label;
    expect(label.length).toBeLessThan(100);
    expect(label).toContain("…");
  });

  it("falls back to position for a card that is only an image", () => {
    // Nothing to quote, and quoting "" would read as a card with a blank front
    // rather than one whose front is a diagram.
    expect(deckCardPart(7, "   ").label).toBe("7");
  });
});

describe("reportMessage", () => {
  it("sends the member's words untouched when the target carries the subject", () => {
    expect(reportMessage(question, "Answer B is right, not C.")).toBe("Answer B is right, not C.");
    expect(reportMessage(module_, "Broken link in step 2.")).toBe("Broken link in step 2.");
  });

  it("prepends the subject when nothing else can carry it", () => {
    // A deck has no FeedbackTargetKind, so this report files as a general one.
    // Without the preamble an admin gets "the back is wrong" about nothing.
    const sent = reportMessage(card, "The back is wrong.");
    expect(sent).toContain("Krebs cycle");
    expect(sent).toContain("card 4");
    expect(sent.endsWith("The back is wrong.")).toBe(true);
  });
});

describe("reportMessageMax", () => {
  it("spends nothing when there is no preamble", () => {
    expect(reportMessageMax(question)).toBe(MESSAGE_MAX);
  });

  it("gives back exactly what the preamble costs", () => {
    // The invariant that matters: a member who fills the box to the limit has
    // the server store every character of it.
    for (const ctx of [module_, question, card]) {
      expect(reportMessage(ctx, "x".repeat(reportMessageMax(ctx))).length).toBe(MESSAGE_MAX);
    }
  });

  it("still leaves room to write when the title is absurd", () => {
    const ctx: ReportContext = { title: "A".repeat(5000), part: deckCardPart(1, "B".repeat(5000)) };
    expect(reportMessageMax(ctx)).toBeGreaterThan(1500);
    expect(reportMessage(ctx, "x".repeat(reportMessageMax(ctx))).length).toBe(MESSAGE_MAX);
  });
});
