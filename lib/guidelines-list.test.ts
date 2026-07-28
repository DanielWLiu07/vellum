import { describe, expect, it } from "vitest";

import {
  currentSeason,
  filterGuidelines,
  groupGuidelines,
  isGeneral,
  seasonFromParam,
} from "./guidelines-list";
import { OFFICIAL_GUIDELINES, type OfficialGuideline } from "./official-guidelines";

const g = (title: string, over: Partial<OfficialGuideline> = {}): OfficialGuideline => ({
  title,
  url: `https://example.test/${title}.pdf`,
  ...over,
});

const RULES = g("Rules and Regulations");
const DRESS = g("Dress Code");
const MEDTERM = g("Medical Terminology");
const NUTRITION = g("Nutrition");
const FORENSIC = g("Forensic Science");

describe("groupGuidelines", () => {
  it("puts all-competitor documents in general and the rest in events", () => {
    const { general, events } = groupGuidelines([RULES, MEDTERM, DRESS, NUTRITION]);
    expect(general.map((x) => x.title)).toEqual(["Rules and Regulations", "Dress Code"]);
    expect(events.map((x) => x.title)).toEqual(["Medical Terminology", "Nutrition"]);
  });

  it("preserves manifest order within each group", () => {
    const { events } = groupGuidelines([NUTRITION, MEDTERM, FORENSIC]);
    expect(events.map((x) => x.title)).toEqual(["Nutrition", "Medical Terminology", "Forensic Science"]);
  });

  it("handles a season with no general documents", () => {
    const { general, events } = groupGuidelines([MEDTERM, NUTRITION]);
    expect(general).toEqual([]);
    expect(events).toHaveLength(2);
  });

  it("handles an empty list", () => {
    expect(groupGuidelines([])).toEqual({ general: [], events: [] });
  });

  it("classifies by exact title, so a similarly-named event stays an event", () => {
    expect(isGeneral(g("Dress Code"))).toBe(true);
    expect(isGeneral(g("Dress Code Appeals"))).toBe(false);
  });
});

describe("filterGuidelines", () => {
  const all = [RULES, DRESS, MEDTERM, NUTRITION, FORENSIC];

  it("returns everything for an empty or whitespace query", () => {
    expect(filterGuidelines(all, "")).toHaveLength(5);
    expect(filterGuidelines(all, "   ")).toHaveLength(5);
  });

  it("matches case-insensitively on a substring", () => {
    expect(filterGuidelines(all, "nutr").map((x) => x.title)).toEqual(["Nutrition"]);
    expect(filterGuidelines(all, "FORENSIC").map((x) => x.title)).toEqual(["Forensic Science"]);
  });

  it("requires every term, so half-remembered names still land", () => {
    expect(filterGuidelines(all, "med term").map((x) => x.title)).toEqual(["Medical Terminology"]);
    expect(filterGuidelines(all, "terminology medical").map((x) => x.title)).toEqual(["Medical Terminology"]);
  });

  it("returns nothing when a term matches nothing", () => {
    expect(filterGuidelines(all, "med zzz")).toEqual([]);
  });

  it("does not mutate its input", () => {
    const input = [...all];
    filterGuidelines(input, "nutrition");
    expect(input).toEqual(all);
  });

  it("filters real manifest entries", () => {
    const season = OFFICIAL_GUIDELINES[0]!;
    const hits = filterGuidelines(season.items, "medical");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((x) => x.title.toLowerCase().includes("medical"))).toBe(true);
  });
});

describe("season selection", () => {
  it("current season is the first in the manifest", () => {
    expect(currentSeason()).toBe(OFFICIAL_GUIDELINES[0]!.year);
  });

  it("accepts a known year and falls back otherwise", () => {
    const known = OFFICIAL_GUIDELINES[1]!.year;
    expect(seasonFromParam(known)).toBe(known);
    expect(seasonFromParam("1999-2000")).toBe(currentSeason());
    expect(seasonFromParam(null)).toBe(currentSeason());
    expect(seasonFromParam(undefined)).toBe(currentSeason());
  });
});
