// View helpers for the official guidelines browser. Pure functions over the
// static manifest (lib/official-guidelines) so the grouping and filtering rules
// can be unit-tested without rendering anything.

import { OFFICIAL_GUIDELINES, type OfficialGuideline } from "./official-guidelines";

/**
 * Documents that apply to every competitor rather than to one event. This is an
 * EXPLICIT list rather than a heuristic on purpose: "Rules and Regulations" and
 * "Dress Code" share no pattern that separates them from event names, and a
 * guess ("anything without a science-y word") would silently misfile a new
 * event the moment HOSA adds one. If HOSA publishes another all-competitor
 * document, add its exact title here.
 */
export const GENERAL_TITLES: readonly string[] = ["Rules and Regulations", "Dress Code"];

export function isGeneral(g: OfficialGuideline): boolean {
  return GENERAL_TITLES.includes(g.title);
}

export interface GuidelineGroups {
  /** All-competitor documents, in manifest order. */
  general: OfficialGuideline[];
  /** Per-event guidelines, in manifest order. */
  events: OfficialGuideline[];
}

/** Split a season's documents into the two things a competitor looks for. */
export function groupGuidelines(items: readonly OfficialGuideline[]): GuidelineGroups {
  const general: OfficialGuideline[] = [];
  const events: OfficialGuideline[] = [];
  for (const g of items) (isGeneral(g) ? general : events).push(g);
  return { general, events };
}

/**
 * Filter by title. Every search term must appear somewhere in the title, so
 * "med term" finds "Medical Terminology" — a competitor typing half-remembered
 * words shouldn't get an empty list. An empty query returns everything.
 */
export function filterGuidelines(items: readonly OfficialGuideline[], query: string): OfficialGuideline[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [...items];
  return items.filter((g) => {
    const title = g.title.toLowerCase();
    return terms.every((t) => title.includes(t));
  });
}

/** Newest season first in the manifest, so the current one heads the list. */
export function currentSeason(): string {
  return OFFICIAL_GUIDELINES[0]!.year;
}

/** The season a `?year=` value asks for, falling back to the current one. */
export function seasonFromParam(value: string | null | undefined): string {
  return OFFICIAL_GUIDELINES.some((s) => s.year === value) ? value! : currentSeason();
}
