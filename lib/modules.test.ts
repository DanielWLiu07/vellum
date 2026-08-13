import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  BODY_MAX,
  MAX_BLOCKS,
  MAX_SECTIONS,
  MAX_SUBSECTIONS,
  __resetModules,
  __seedSnapshotRow,
  blockHasContent,
  createModule,
  deleteModule,
  embedUrlFor,
  getModule,
  isModuleDoc,
  listModules,
  parseSlides,
  subHasContent,
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
    expect(embedUrlFor({ id: "b1", kind: "slides", slidesId: FILE_ID, slidesPub: false })).toBe(`https://docs.google.com/presentation/d/${FILE_ID}/embed`);
  });
  it("builds a published Slides embed url", () => {
    expect(embedUrlFor({ id: "b1", kind: "slides", slidesId: PUB_ID, slidesPub: true })).toBe(`https://docs.google.com/presentation/d/e/${PUB_ID}/embed`);
  });
  it("builds a Docs preview url", () => {
    expect(embedUrlFor({ id: "b1", kind: "doc", slidesId: FILE_ID, slidesPub: false })).toBe(`https://docs.google.com/document/d/${FILE_ID}/preview`);
  });
  it("is empty for a non-google block or when unlinked", () => {
    expect(embedUrlFor({ id: "b1", kind: "slides", slidesId: "", slidesPub: false })).toBe("");
    expect(embedUrlFor({ id: "b1", kind: "pdf", docId: "u_abcdef12" })).toBe("");
    expect(embedUrlFor({ id: "b1", kind: "info", body: "text" })).toBe("");
  });
});

describe("blockHasContent / subHasContent", () => {
  it("is true only for a block that points at something", () => {
    expect(blockHasContent({ id: "b", kind: "slides", slidesId: FILE_ID, slidesPub: false })).toBe(true);
    expect(blockHasContent({ id: "b", kind: "slides", slidesId: "", slidesPub: false })).toBe(false);
    expect(blockHasContent({ id: "b", kind: "pdf", docId: "u_abcdef12" })).toBe(true);
    expect(blockHasContent({ id: "b", kind: "pdf", docId: "" })).toBe(false);
    expect(blockHasContent({ id: "b", kind: "info", body: "  " })).toBe(false);
  });

  it("counts a part with ANY non-empty block, and no part with none", () => {
    expect(subHasContent({ id: "s", title: "t", blocks: [] })).toBe(false);
    expect(subHasContent({
      id: "s",
      title: "t",
      blocks: [{ id: "b1", kind: "slides", slidesId: "", slidesPub: false }, { id: "b2", kind: "info", body: "note" }],
    })).toBe(true);
  });
});

describe("createModule blocks", () => {
  it("stacks blocks in a part, in order, preserving each payload", () => {
    const m = createModule("Airway", "you", {
      sections: [{
        title: "Intro",
        subsections: [{
          title: "Everything on airways",
          blocks: [
            { id: "b1", kind: "info", body: "  Read this first.  " },
            { id: "b2", kind: "slides", slides: `https://docs.google.com/presentation/d/${FILE_ID}/edit` },
            { id: "b3", kind: "pdf", docId: "u_worksheet1" },
          ],
        }],
      }],
    });
    expect(m.sections[0]!.subsections[0]!.blocks).toEqual([
      { id: "b1", kind: "info", body: "Read this first." },
      { id: "b2", kind: "slides", slidesId: FILE_ID, slidesPub: false },
      { id: "b3", kind: "pdf", docId: "u_worksheet1" },
    ]);
  });

  it("takes the block kind from the pasted link, not the declared one", () => {
    const m = createModule("D", "you", {
      sections: [{ subsections: [{ blocks: [{ kind: "slides", slides: `https://docs.google.com/document/d/${FILE_ID}/edit` }] }] }],
    });
    expect(m.sections[0]!.subsections[0]!.blocks[0]).toMatchObject({ kind: "doc", slidesId: FILE_ID });
  });

  it("still accepts the editor's 'google' kind for an unlinked block", () => {
    const m = createModule("G", "you", { sections: [{ subsections: [{ blocks: [{ kind: "google", slides: "" }] }] }] });
    expect(m.sections[0]!.subsections[0]!.blocks[0]).toMatchObject({ kind: "slides", slidesId: "" });
  });

  it("leaves a part with no blocks, and defaults titles", () => {
    const m = createModule("X", "you", { sections: [{ subsections: [{ blocks: [] }] }] });
    expect(m.sections[0]!.title).toBe("Section 1");
    expect(m.sections[0]!.subsections[0]!.title).toBe("Part 1");
    expect(m.sections[0]!.subsections[0]!.blocks).toEqual([]);
  });

  it("caps sections, subsections, and blocks", () => {
    const blocks = Array.from({ length: MAX_BLOCKS + 5 }, () => ({ kind: "info", body: "b" }));
    const subs = Array.from({ length: MAX_SUBSECTIONS + 5 }, () => ({ title: "s", blocks }));
    const sections = Array.from({ length: MAX_SECTIONS + 5 }, (_, i) => ({ title: `S${i}`, subsections: subs }));
    const m = createModule("Big", "you", { sections });
    expect(m.sections.length).toBe(MAX_SECTIONS);
    expect(m.sections[0]!.subsections.length).toBe(MAX_SUBSECTIONS);
    expect(m.sections[0]!.subsections[0]!.blocks.length).toBe(MAX_BLOCKS);
  });
});

describe("block validation", () => {
  it("drops a block whose kind nothing can render", () => {
    const m = createModule("V", "you", {
      sections: [{ subsections: [{ blocks: [{ kind: "video", src: "https://evil.example.com/x.mp4" }, { kind: "info", body: "kept" }] }] }],
    });
    expect(m.sections[0]!.subsections[0]!.blocks).toEqual([{ id: expect.any(String), kind: "info", body: "kept" }]);
  });

  it("rejects a non-array blocks field instead of re-reading it as a legacy part", () => {
    const m = createModule("N", "you", {
      // Both shapes at once: `blocks` is present but wrong, and the legacy
      // payload sits alongside it. The wrong field is bad input, not an old
      // record, so nothing is salvaged from either.
      sections: [{ subsections: [{ id: "s1", blocks: "not-an-array", kind: "info", body: "sneaky" }] }],
    });
    expect(m.sections[0]!.subsections[0]!.blocks).toEqual([]);
  });

  it("drops a block that isn't an object", () => {
    const m = createModule("N", "you", { sections: [{ subsections: [{ blocks: ["x", null, 7, { kind: "info", body: "kept" }] }] }] });
    expect(m.sections[0]!.subsections[0]!.blocks).toHaveLength(1);
  });

  it("clamps an oversized info body", () => {
    const m = createModule("Long", "you", { sections: [{ subsections: [{ blocks: [{ kind: "info", body: "x".repeat(BODY_MAX + 500) }] }] }] });
    const block = m.sections[0]!.subsections[0]!.blocks[0]!;
    expect(block.kind === "info" && block.body.length).toBe(BODY_MAX);
  });

  it("rejects an oversized or malformed link rather than storing it", () => {
    const m = createModule("Bad", "you", {
      sections: [{ subsections: [{ blocks: [{ kind: "slides", slides: `https://evil.example.com/${"a".repeat(5000)}` }] }] }],
    });
    expect(m.sections[0]!.subsections[0]!.blocks[0]).toMatchObject({ kind: "slides", slidesId: "" });
  });

  it("rejects a malformed docId", () => {
    const m = createModule("P", "you", { sections: [{ subsections: [{ blocks: [{ kind: "pdf", docId: "../etc/passwd" }] }] }] });
    expect(m.sections[0]!.subsections[0]!.blocks[0]).toEqual({ id: expect.any(String), kind: "pdf", docId: "" });
  });

  it("isModuleDoc gates PDF rendering to module-referenced uploads only", () => {
    createModule("P", "you", {
      sections: [{ subsections: [{ blocks: [{ kind: "info", body: "intro" }, { kind: "pdf", docId: "u_referenced" }] }] }],
    });
    expect(isModuleDoc("u_referenced")).toBe(true);
    expect(isModuleDoc("u_someone_elses_private_upload")).toBe(false);
    expect(isModuleDoc("")).toBe(false);
  });
});

/**
 * THE CONTRACT. A subsection written by the pre-blocks build held exactly one
 * artifact on the subsection itself. Those rows are in .data/modules.json right
 * now; they must read as a one-block part with the payload intact, and their
 * subsection ids - which study progress is keyed on - must not move.
 */
describe("legacy snapshot rows", () => {
  const legacySub = (id: string, title: string, rest: Record<string, unknown>) => ({
    id, title, kind: "slides", slidesId: "", slidesPub: false, docId: "", body: "", ...rest,
  });
  const seedLegacy = () =>
    __seedSnapshotRow("legacy", {
      id: "legacy",
      title: "Legacy module",
      owner: "sys",
      createdAt: 1,
      sections: [{
        id: "sec1",
        title: "Section one",
        subsections: [
          legacySub("ss1", "Deck", { kind: "slides", slidesId: FILE_ID }),
          legacySub("ss2", "Notes", { kind: "info", body: "Read this." }),
          legacySub("ss3", "Worksheet", { kind: "pdf", docId: "u_worksheet1" }),
          legacySub("ss4", "Handout", { kind: "doc", slidesId: FILE_ID }),
          legacySub("ss5", "Published deck", { kind: "slides", slidesId: PUB_ID, slidesPub: true }),
          legacySub("ss6", "Never linked", {}),
        ],
      }],
    });

  it("renders each legacy part as one block with the right payload", () => {
    seedLegacy();
    const subs = getModule("legacy")!.sections[0]!.subsections;
    expect(subs.map((s) => s.blocks)).toEqual([
      [{ id: "ss1_b0", kind: "slides", slidesId: FILE_ID, slidesPub: false }],
      [{ id: "ss2_b0", kind: "info", body: "Read this." }],
      [{ id: "ss3_b0", kind: "pdf", docId: "u_worksheet1" }],
      // A stored bare id can't say whether it is a doc or a deck, so the part's
      // declared kind decides - otherwise every saved Doc would come back Slides.
      [{ id: "ss4_b0", kind: "doc", slidesId: FILE_ID, slidesPub: false }],
      // Published ids are short; one must survive the trip back out.
      [{ id: "ss5_b0", kind: "slides", slidesId: PUB_ID, slidesPub: true }],
      [{ id: "ss6_b0", kind: "slides", slidesId: "", slidesPub: false }],
    ]);
  });

  it("keeps subsection ids and titles, which study progress is keyed on", () => {
    seedLegacy();
    const subs = getModule("legacy")!.sections[0]!.subsections;
    expect(subs.map((s) => s.id)).toEqual(["ss1", "ss2", "ss3", "ss4", "ss5", "ss6"]);
    expect(subs.map((s) => s.title)).toEqual(["Deck", "Notes", "Worksheet", "Handout", "Published deck", "Never linked"]);
  });

  it("drops the old fields rather than carrying both shapes", () => {
    seedLegacy();
    const sub = getModule("legacy")!.sections[0]!.subsections[0]! as unknown as Record<string, unknown>;
    expect(sub.kind).toBeUndefined();
    expect(sub.slidesId).toBeUndefined();
    expect(Object.keys(sub).sort()).toEqual(["blocks", "id", "title"]);
  });

  it("counts a legacy module's linked parts and finds its PDFs", () => {
    seedLegacy();
    const meta = listModules().find((m) => m.id === "legacy")!;
    expect(meta.subsectionCount).toBe(6);
    expect(meta.linkedCount).toBe(5); // ss6 never got a link
    expect(isModuleDoc("u_worksheet1")).toBe(true);
  });

  it("reads a HALF-MIGRATED store - both shapes present at once", () => {
    seedLegacy();
    const fresh = createModule("Fresh", "you", {
      sections: [{ subsections: [{ blocks: [{ kind: "info", body: "new shape" }] }] }],
    });
    expect(listModules().map((m) => m.id).sort()).toEqual(["legacy", fresh.id].sort());
    expect(getModule("legacy")!.sections[0]!.subsections[0]!.blocks[0]).toMatchObject({ kind: "slides" });
    expect(getModule(fresh.id)!.sections[0]!.subsections[0]!.blocks[0]).toMatchObject({ kind: "info" });
  });

  it("migrates on write too: a legacy row saved once is stored as blocks", () => {
    seedLegacy();
    // Only the title is patched - sections are untouched by the caller, so the
    // row's new shape can only come from the read boundary.
    const up = updateModule("legacy", { title: "Renamed" })!;
    expect(up.title).toBe("Renamed");
    expect(up.sections[0]!.subsections[0]!.blocks).toEqual([{ id: "ss1_b0", kind: "slides", slidesId: FILE_ID, slidesPub: false }]);
  });

  it("is stable when migrated twice - the same row, the same block ids", () => {
    seedLegacy();
    const first = JSON.stringify(getModule("legacy"));
    expect(JSON.stringify(getModule("legacy"))).toBe(first);
  });

  it("accepts the pre-blocks shape from a stale editor tab PATCHing over a deploy", () => {
    const m = createModule("Old client", "you", {
      sections: [{ title: "S", subsections: [{ id: "keep-me", title: "P", kind: "info", body: "typed before the deploy" }] }],
    });
    const sub = m.sections[0]!.subsections[0]!;
    expect(sub.id).toBe("keep-me");
    expect(sub.blocks).toEqual([{ id: "keep-me_b0", kind: "info", body: "typed before the deploy" }]);
  });
});

describe("listModules", () => {
  it("counts sections, subsections, and parts with content; newest first", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(1_000_000));
      createModule("First", "you", { sections: [{ subsections: [{ title: "a", blocks: [] }] }] });
      vi.setSystemTime(new Date(2_000_000));
      const second = createModule("Second", "you", {
        sections: [{ subsections: [{ blocks: [{ kind: "slides", slides: FILE_ID }] }, { title: "no-deck", blocks: [] }] }],
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
    const m = createModule("Old", "you", { sections: [{ title: "a", subsections: [{ blocks: [] }] }] });
    const up = updateModule(m.id, {
      title: "New",
      sections: [{ title: "b", subsections: [{ title: "p", blocks: [{ kind: "slides", slides: FILE_ID }] }] }],
    });
    expect(up?.title).toBe("New");
    expect(up?.sections[0]!.subsections[0]!.title).toBe("p");
    expect(up?.sections[0]!.subsections[0]!.blocks[0]).toMatchObject({ slidesId: FILE_ID });
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
