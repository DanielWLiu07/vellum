import { describe, expect, it } from "vitest";

import {
  RETURN_TO,
  dashboardReturn,
  readReturn,
  resolveReturn,
  returnLabel,
  withBack,
} from "./return-to";

const QUIZ = "q_1a2b3c";

describe("resolveReturn — accepted targets", () => {
  it("keeps a plain dashboard target", () => {
    expect(resolveReturn("/dashboard", RETURN_TO.quizzes)).toBe("/dashboard");
  });

  it("round-trips the dashboard's role and section", () => {
    expect(resolveReturn("/dashboard?role=advisor&section=quizzes", RETURN_TO.dashboard)).toBe(
      "/dashboard?role=advisor&section=quizzes",
    );
  });

  it("orders the query the same way whatever order it arrived in", () => {
    expect(resolveReturn("/dashboard?section=modules&role=admin", RETURN_TO.dashboard)).toBe(
      "/dashboard?role=admin&section=modules",
    );
  });

  it("accepts every content route a flow can be entered from", () => {
    for (const path of [
      "/upload",
      "/profile",
      `/view/${QUIZ}`,
      `/quizzes/${QUIZ}`,
      `/quizzes/${QUIZ}/edit`,
      `/quizzes/${QUIZ}/attempts`,
      `/decks/${QUIZ}`,
      `/decks/${QUIZ}/edit`,
      `/modules/${QUIZ}`,
      `/modules/${QUIZ}/edit`,
    ]) {
      expect(resolveReturn(path, RETURN_TO.dashboard)).toBe(path);
    }
  });

  it("keeps the params those routes actually use", () => {
    expect(resolveReturn("/upload?type=quiz", RETURN_TO.dashboard)).toBe("/upload?type=quiz");
    expect(resolveReturn(`/view/${QUIZ}?mode=slides`, RETURN_TO.dashboard)).toBe(`/view/${QUIZ}?mode=slides`);
  });

  it("normalizes away a trailing slash and a fragment", () => {
    expect(resolveReturn("/dashboard/?section=quizzes#anchor", RETURN_TO.modules)).toBe("/dashboard?section=quizzes");
  });
});

describe("resolveReturn — rejected targets fall back", () => {
  const cases: [string, string][] = [
    ["absolute http URL", "http://evil.example/dashboard"],
    ["absolute https URL", "https://evil.example/dashboard"],
    ["protocol-relative", "//evil.example/dashboard"],
    ["backslash-folded host", "/\\evil.example"],
    ["javascript:", "javascript:alert(1)"],
    ["data:", "data:text/html,<script>"],
    ["relative path", "dashboard?section=quizzes"],
    ["traversal out of an allowed route", "/quizzes/../../etc/passwd"],
    ["encoded traversal", "/quizzes/%2e%2e/%2e%2e/etc/passwd"],
    ["unknown route", "/admin/secrets"],
    ["dashboard prefix that isn't the dashboard", "/dashboardish"],
    ["route with a bad id", "/quizzes/../edit"],
    ["route with an id full of punctuation", "/quizzes/a!b/edit"],
    ["route with an extra segment", `/quizzes/${QUIZ}/edit/extra`],
    ["newline in the value", "/dashboard\n/evil"],
    ["empty string", ""],
    ["over-long value", `/dashboard?section=quizzes&role=${"a".repeat(600)}`],
  ];
  for (const [name, raw] of cases) {
    it(`rejects ${name}`, () => {
      expect(resolveReturn(raw, RETURN_TO.quizzes)).toBe(RETURN_TO.quizzes);
    });
  }

  it("rejects a missing value", () => {
    expect(resolveReturn(undefined, RETURN_TO.modules)).toBe(RETURN_TO.modules);
    expect(resolveReturn(null, RETURN_TO.modules)).toBe(RETURN_TO.modules);
  });

  it("rejects a repeated ?back= (Next hands those over as an array)", () => {
    expect(resolveReturn(["/dashboard", "https://evil.example"], RETURN_TO.flashcards)).toBe(RETURN_TO.flashcards);
  });

  it("falls back to the dashboard when even the fallback is junk", () => {
    expect(resolveReturn("https://evil.example", "https://also-evil.example")).toBe("/dashboard");
  });
});

describe("resolveReturn — query values are re-checked, not echoed", () => {
  it("drops a role that isn't a role", () => {
    expect(resolveReturn("/dashboard?role=superuser&section=quizzes", RETURN_TO.dashboard)).toBe(
      "/dashboard?section=quizzes",
    );
  });

  it("drops a section that isn't in any sidebar", () => {
    expect(resolveReturn("/dashboard?role=admin&section=../../etc", RETURN_TO.dashboard)).toBe("/dashboard?role=admin");
  });

  it("drops params the destination never reads", () => {
    expect(resolveReturn("/dashboard?section=quizzes&token=abc123&next=//evil.example", RETURN_TO.dashboard)).toBe(
      "/dashboard?section=quizzes",
    );
  });

  it("drops a repeated param rather than guessing which one wins", () => {
    expect(resolveReturn("/dashboard?section=quizzes&section=modules", RETURN_TO.dashboard)).toBe("/dashboard");
  });

  it("drops an out-of-range mode or type", () => {
    expect(resolveReturn(`/view/${QUIZ}?mode=download`, RETURN_TO.dashboard)).toBe(`/view/${QUIZ}`);
    expect(resolveReturn("/upload?type=exam", RETURN_TO.dashboard)).toBe("/upload");
  });
});

describe("resolveReturn — nested targets", () => {
  it("validates a nested target and keeps it", () => {
    const nested = `/quizzes/${QUIZ}/edit?back=${encodeURIComponent("/dashboard?section=quizzes")}`;
    expect(resolveReturn(nested, RETURN_TO.quizzes)).toBe(nested);
  });

  it("drops a nested target that would leave the app, keeping the outer one", () => {
    const nested = `/quizzes/${QUIZ}/edit?back=${encodeURIComponent("https://evil.example")}`;
    expect(resolveReturn(nested, RETURN_TO.quizzes)).toBe(`/quizzes/${QUIZ}/edit`);
  });

  it("stops nesting before a chain can grow without bound", () => {
    let target = "/dashboard?section=quizzes";
    for (let i = 0; i < 6; i++) target = withBack(`/quizzes/${QUIZ}/edit`, target);
    const resolved = resolveReturn(target, RETURN_TO.quizzes);
    expect(resolved.startsWith(`/quizzes/${QUIZ}/edit`)).toBe(true);
    expect(resolved.split("back=").length - 1).toBeLessThanOrEqual(3);
  });
});

describe("readReturn", () => {
  it("is null when there's nothing usable, so callers can pick their own default", () => {
    expect(readReturn(undefined)).toBeNull();
    expect(readReturn("https://evil.example")).toBeNull();
  });

  it("returns the canonical target when there is one", () => {
    expect(readReturn("/dashboard?section=resources")).toBe("/dashboard?section=resources");
  });
});

describe("withBack", () => {
  it("adds the target to a bare path", () => {
    expect(withBack(`/quizzes/${QUIZ}`, "/dashboard?section=quizzes")).toBe(
      `/quizzes/${QUIZ}?back=${encodeURIComponent("/dashboard?section=quizzes")}`,
    );
  });

  it("appends to a path that already has a query", () => {
    expect(withBack("/upload?type=quiz", "/dashboard?section=quizzes")).toBe(
      `/upload?type=quiz&back=${encodeURIComponent("/dashboard?section=quizzes")}`,
    );
  });

  it("leaves the link alone rather than attaching a target it can't vouch for", () => {
    expect(withBack(`/quizzes/${QUIZ}`, "https://evil.example")).toBe(`/quizzes/${QUIZ}`);
    expect(withBack(`/quizzes/${QUIZ}`, null)).toBe(`/quizzes/${QUIZ}`);
  });

  it("canonicalizes the target it attaches", () => {
    expect(withBack(`/quizzes/${QUIZ}`, "/dashboard?token=abc&section=quizzes")).toBe(
      `/quizzes/${QUIZ}?back=${encodeURIComponent("/dashboard?section=quizzes")}`,
    );
  });
});

describe("dashboardReturn", () => {
  it("carries a valid role and section", () => {
    expect(dashboardReturn("advisor", "quizzes")).toBe("/dashboard?role=advisor&section=quizzes");
  });

  it("omits what it can't vouch for", () => {
    expect(dashboardReturn("superuser", "quizzes")).toBe("/dashboard?section=quizzes");
    expect(dashboardReturn("admin", "nonsense")).toBe("/dashboard?role=admin");
    expect(dashboardReturn(null, null)).toBe("/dashboard");
  });

  it("produces targets that survive resolveReturn unchanged", () => {
    const target = dashboardReturn("trainer", "flashcards");
    expect(resolveReturn(target, RETURN_TO.dashboard)).toBe(target);
  });
});

describe("returnLabel", () => {
  it("names a dashboard section the way the sidebar does", () => {
    expect(returnLabel("/dashboard?section=quizzes")).toBe("Quizzes");
    expect(returnLabel("/dashboard?role=admin&section=modules")).toBe("Modules");
    expect(returnLabel("/dashboard?section=assignments")).toBe("My assignments");
    expect(returnLabel("/dashboard")).toBe("Dashboard");
  });

  it("names the content pages", () => {
    expect(returnLabel(`/quizzes/${QUIZ}/edit`)).toBe("Quiz editor");
    expect(returnLabel(`/quizzes/${QUIZ}/attempts`)).toBe("Exam attempts");
    expect(returnLabel(`/quizzes/${QUIZ}`)).toBe("Quiz");
    expect(returnLabel(`/decks/${QUIZ}/edit`)).toBe("Deck editor");
    expect(returnLabel(`/modules/${QUIZ}`)).toBe("Module");
    expect(returnLabel(`/view/${QUIZ}`)).toBe("Document");
    expect(returnLabel("/upload")).toBe("Add content");
    expect(returnLabel("/profile")).toBe("Profile");
  });

  it("falls back to Dashboard for anything it can't name", () => {
    expect(returnLabel("https://evil.example")).toBe("Dashboard");
    expect(returnLabel("/dashboard?section=not-a-section")).toBe("Dashboard");
  });
});
