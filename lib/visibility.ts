/**
 * Resource visibility scopes, shared by the API, the create forms, and the
 * dashboard filters. Pure so it can run on the client and the server.
 *
 * The standalone dashboard has no real auth, so the "current viewer" is a demo
 * identity. In a real deployment this comes from the signed session.
 */

export type Visibility = "public" | "chapter" | "private";

export const VISIBILITIES: { id: Visibility; label: string; hint: string }[] = [
  { id: "public", label: "Public", hint: "Anyone can see it" },
  { id: "chapter", label: "Chapter only", hint: "Only your chapter" },
  { id: "private", label: "Private", hint: "Only you" },
];

export interface Scoped {
  visibility: Visibility;
  chapter: string;
  owner: string;
}

export interface Viewer {
  owner: string;
  chapter: string;
  admin: boolean;
}

/** Demo identity for the standalone dashboard (no auth). */
export const DEMO_VIEWER: Viewer = { owner: "you", chapter: "Toronto Central", admin: false };

export function normalizeVisibility(v: unknown): Visibility {
  return v === "chapter" || v === "private" ? v : "public";
}

/** Whether a viewer is allowed to see a scoped resource. */
export function canView(r: Scoped, v: Viewer): boolean {
  if (v.admin) return true;
  if (r.visibility === "public") return true;
  if (r.visibility === "chapter") return r.chapter === v.chapter;
  return r.owner === v.owner;
}

export type FilterMode = "accessible" | "public" | "chapter" | "mine";

/** Apply a dashboard filter on top of the base access check. */
export function filterScoped<T extends Scoped>(items: T[], v: Viewer, mode: FilterMode): T[] {
  return items.filter((r) => {
    if (!canView(r, v)) return false;
    if (mode === "public") return r.visibility === "public";
    if (mode === "chapter") return r.chapter === v.chapter;
    if (mode === "mine") return r.owner === v.owner;
    return true;
  });
}
