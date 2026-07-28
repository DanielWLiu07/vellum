import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  MAX_SECTIONS,
  MAX_SUBSECTIONS,
  __resetModules,
  createModule,
  deleteModule,
  embedUrlFor,
  getModule,
  isModuleDoc,
  listModules,
  parseSlides,
  updateModule,
} from "./modules";

const FILE_ID = "1AbcDEF_ghIJKlmnop123456789";
const PUB_ID = "2PACX-1vABCdef";

beforeEach(() => __resetModules());
afterEach(() => __resetModules());

describe("parseSlides", () => {
  it("parses a Slides file /edit link", () => {
    expect(parseSlides(`https://docs.google.com/presentation/d/${FILE_ID}/edit#slide=id.p1`)).toEqual({ id: FILE_ID, kind: "slides", pub: false });
  });
  it("parses a published /d/e/ Slides link as pub", () => {
    expect(parseSlides(`https://docs.google.com/presentation/d/e/${PUB_ID}/pub`)).toEqual({ id: PUB_ID, kind: "slides", pub: true });
  });
  it("parses a Google Docs link as kind=doc", () => {
    expect(parseSlides(`https://docs.google.com/document/d/${FILE_ID}/edit`)).toEqual({ id: FILE_ID, kind: "doc", pub: false });
  });
  it("accepts a bare id (defaults to slides)", () => {
    expect(parseSlides(FILE_ID)).toEqual({ id: FILE_ID, kind: "slides", pub: false });
  });
  it("rejects a non-Google link", () => {
    expect(parseSlides("https://evil.example.com/presentation/d/x/edit")).toBeNull();
    expect(parseSlides("random text")).toBeNull();
    expect(parseSlides("")).toBeNull();
  });
});

describe("embedUrlFor", () => {
  it("builds a Slides embed url", () => {
    expect(embedUrlFor({ kind: "slides", slidesId: FILE_ID, slidesPub: false })).toBe(`https://docs.google.com/presentation/d/${FILE_ID}/embed`);
  });
  it("builds a published Slides embed url", () => {
    expect(embedUrlFor({ kind: "slides", slidesId: PUB_ID, slidesPub: true })).toBe(`https://docs.google.com/presentation/d/e/${PUB_ID}/embed`);
  });
  it("builds a Docs preview url", () => {
    expect(embedUrlFor({ kind: "doc", slidesId: FILE_ID, slidesPub: false })).toBe(`https://docs.google.com/document/d/${FILE_ID}/preview`);
  });
  it("is empty for a non-google kind or when unlinked", () => {
    expect(embedUrlFor({ kind: "slides", slidesId: "", slidesPub: false })).toBe("");
    expect(embedUrlFor({ kind: "pdf", slidesId: FILE_ID, slidesPub: false })).toBe("");
  });
});

describe("createModule content types", () => {
  it("parses a Google slides link into kind + id + pub", () => {
    const m = createModule("Airway", "you", {
      sections: [{ title: "Intro", subsections: [{ title: "Part A", slides: `https://docs.google.com/presentation/d/${FILE_ID}/edit` }] }],
    });
    const ss = m.sections[0]!.subsections[0]!;
    expect(ss.title).toBe("Part A");
    expect(ss.kind).toBe("slides");
    expect(ss.slidesId).toBe(FILE_ID);
    expect(ss.slidesPub).toBe(false);
  });

  it("stores an uploaded PDF subsection (kind pdf, docId)", () => {
    const m = createModule("P", "you", { sections: [{ subsections: [{ kind: "pdf", docId: "u_abcdef12" }] }] });
    const ss = m.sections[0]!.subsections[0]!;
    expect(ss.kind).toBe("pdf");
    expect(ss.docId).toBe("u_abcdef12");
    expect(ss.slidesId).toBe("");
  });

  it("rejects a malformed docId", () => {
    const m = createModule("P", "you", { sections: [{ subsections: [{ kind: "pdf", docId: "../etc/passwd" }] }] });
    expect(m.sections[0]!.subsections[0]!.docId).toBe("");
  });

  it("stores an info subsection (kind info, body)", () => {
    const m = createModule("I", "you", { sections: [{ subsections: [{ kind: "info", body: "  Line one\nLine two  " }] }] });
    const ss = m.sections[0]!.subsections[0]!;
    expect(ss.kind).toBe("info");
    expect(ss.body).toBe("Line one\nLine two");
  });

  it("isModuleDoc gates PDF rendering to module-referenced uploads only", () => {
    createModule("P", "you", { sections: [{ subsections: [{ kind: "pdf", docId: "u_referenced" }] }] });
    expect(isModuleDoc("u_referenced")).toBe(true);
    expect(isModuleDoc("u_someone_elses_private_upload")).toBe(false);
    expect(isModuleDoc("")).toBe(false);
  });

  it("leaves an unlinked subsection empty and defaults titles", () => {
    const m = createModule("X", "you", { sections: [{ subsections: [{}] }] });
    expect(m.sections[0]!.title).toBe("Section 1");
    expect(m.sections[0]!.subsections[0]!.title).toBe("Part 1");
    expect(m.sections[0]!.subsections[0]!.slidesId).toBe("");
  });

  it("caps sections and subsections", () => {
    const subs = Array.from({ length: MAX_SUBSECTIONS + 5 }, () => ({ title: "s" }));
    const sections = Array.from({ length: MAX_SECTIONS + 5 }, (_, i) => ({ title: `S${i}`, subsections: subs }));
    const m = createModule("Big", "you", { sections });
    expect(m.sections.length).toBe(MAX_SECTIONS);
    expect(m.sections[0]!.subsections.length).toBe(MAX_SUBSECTIONS);
  });
});

describe("listModules", () => {
  it("counts sections, subsections, and LINKED decks; newest first", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(1_000_000));
      createModule("First", "you", { sections: [{ subsections: [{ title: "a" }] }] });
      vi.setSystemTime(new Date(2_000_000));
      const second = createModule("Second", "you", {
        sections: [{ subsections: [{ slides: FILE_ID }, { title: "no-deck" }] }],
      });
      const list = listModules();
      expect(list[0]!.id).toBe(second.id);
      expect(list[0]!.subsectionCount).toBe(2);
      expect(list[0]!.linkedCount).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("updateModule / deleteModule", () => {
  it("updates title and replaces sections", () => {
    const m = createModule("Old", "you", { sections: [{ title: "a", subsections: [{}] }] });
    const up = updateModule(m.id, { title: "New", sections: [{ title: "b", subsections: [{ title: "p", slides: FILE_ID }] }] });
    expect(up?.title).toBe("New");
    expect(up?.sections[0]!.subsections[0]!.title).toBe("p");
    expect(up?.sections[0]!.subsections[0]!.slidesId).toBe(FILE_ID);
  });

  it("deletes a module", () => {
    const m = createModule("Temp", "you");
    expect(deleteModule(m.id)).toBe(true);
    expect(getModule(m.id)).toBeUndefined();
  });

  it("refuses to mutate or delete the reserved sample id (guarded by id)", () => {
    expect(updateModule("sample-module", { title: "hax" })).toBeUndefined();
    expect(deleteModule("sample-module")).toBe(false);
  });
});
