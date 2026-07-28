/**
 * Pure sort + search helpers for resource grids. Kept framework-free so they
 * can be unit-tested and reused by every grid (documents, "my/chapter
 * lessons", the resources pool).
 */

export interface ResourceLike {
  id: string;
  name: string;
  owner: string;
  sizeBytes: number;
  uploadedAt: number;
  event?: string;
}

export type DocSort =
  | "newest"
  | "oldest"
  | "name-az"
  | "name-za"
  | "largest"
  | "smallest"
  | "most-saved"
  | "event";

export const DOC_SORTS: { id: DocSort; label: string }[] = [
  { id: "newest", label: "Newest first" },
  { id: "oldest", label: "Oldest first" },
  { id: "most-saved", label: "Most saved" },
  { id: "event", label: "By event" },
  { id: "name-az", label: "Name A-Z" },
  { id: "name-za", label: "Name Z-A" },
  { id: "largest", label: "Largest first" },
  { id: "smallest", label: "Smallest first" },
];

// numeric:true so "Week 2" sorts before "Week 10"; base sensitivity keeps
// case/accents from splitting otherwise-equal names.
function byName(a: ResourceLike, b: ResourceLike): number {
  return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
}

/**
 * Sort a copy of `docs`. `countOf` supplies the like-count for the "most-saved"
 * sort (defaults to 0 so callers without favorites still work). Ties always
 * fall back to name order, so results are stable and predictable.
 */
export function sortDocs<T extends ResourceLike>(
  docs: T[],
  sort: DocSort,
  countOf: (id: string) => number = () => 0,
): T[] {
  const out = [...docs];
  switch (sort) {
    case "newest": out.sort((a, b) => b.uploadedAt - a.uploadedAt || byName(a, b)); break;
    case "oldest": out.sort((a, b) => a.uploadedAt - b.uploadedAt || byName(a, b)); break;
    case "name-az": out.sort(byName); break;
    case "name-za": out.sort((a, b) => byName(b, a)); break;
    case "largest": out.sort((a, b) => b.sizeBytes - a.sizeBytes || byName(a, b)); break;
    case "smallest": out.sort((a, b) => a.sizeBytes - b.sizeBytes || byName(a, b)); break;
    case "most-saved": out.sort((a, b) => countOf(b.id) - countOf(a.id) || byName(a, b)); break;
    case "event": out.sort((a, b) => {
      const ea = (a.event ?? "").toLowerCase();
      const eb = (b.event ?? "").toLowerCase();
      if (ea === eb) return byName(a, b);
      if (!ea) return 1; // untagged resources sort to the end
      if (!eb) return -1;
      return ea.localeCompare(eb);
    }); break;
  }
  return out;
}

/**
 * Intuitive search: every whitespace-separated word in `term` must appear
 * somewhere in the resource's name, owner, or event (case-insensitive). So
 * "ecg basics" matches "ECG interpretation - the basics", and "priya nutrition"
 * matches a nutrition guide shared by Priya. Empty query matches everything.
 */
export function matchesQuery(d: { name: string; owner: string; event?: string }, term: string): boolean {
  const words = term.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const hay = `${d.name} ${d.owner} ${d.event ?? ""}`.toLowerCase();
  return words.every((w) => hay.includes(w));
}
