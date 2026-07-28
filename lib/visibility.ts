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
  { id: "private", label: "Private", hint: "Only you and people you add" },
];

/** A direct, per-person grant on a resource (Google-Docs-style "Add people"). */
export type ShareRole = "viewer" | "editor";

export interface PersonShare {
  person: string;
  role: ShareRole;
}

export const SHARE_ROLES: { id: ShareRole; label: string }[] = [
  { id: "viewer", label: "Viewer" },
  { id: "editor", label: "Editor" },
];

export interface Scoped {
  visibility: Visibility;
  chapter: string;
  owner: string;
  /** Direct grants; checked in addition to the visibility scope. */
  people?: PersonShare[];
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

export const MAX_PEOPLE = 20;
const PERSON_MAX = 60;

/**
 * Validate an untrusted people list into a clean PersonShare[]: objects only,
 * trimmed/clamped names, viewer|editor roles, no duplicates (last entry wins,
 * so re-adding someone updates their role), capped at MAX_PEOPLE.
 */
export function normalizePeople(raw: unknown, owner?: string): PersonShare[] {
  if (!Array.isArray(raw)) return [];
  const byPerson = new Map<string, PersonShare>();
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const person = typeof e.person === "string" ? e.person.trim().slice(0, PERSON_MAX) : "";
    if (!person) continue;
    if (owner && person === owner) continue; // the owner already has full access
    const role: ShareRole = e.role === "editor" ? "editor" : "viewer";
    byPerson.set(person, { person, role });
  }
  return [...byPerson.values()].slice(0, MAX_PEOPLE);
}

/** Whether a viewer is allowed to see a scoped resource. */
export function canView(r: Scoped, v: Viewer): boolean {
  if (v.admin) return true;
  if (r.owner === v.owner) return true;
  if (r.people?.some((p) => p.person === v.owner)) return true;
  if (r.visibility === "public") return true;
  if (r.visibility === "chapter") return r.chapter === v.chapter;
  return false;
}

/**
 * Whether a viewer may change a resource's CONTENT (edit cards/questions,
 * rename): the owner, an admin, or someone granted the editor role.
 * Immutability of bundled/sample resources is the caller's check — this is
 * purely the permission question.
 */
export function canEdit(r: Scoped, v: Viewer): boolean {
  if (v.admin) return true;
  if (r.owner === v.owner) return true;
  return r.people?.some((p) => p.person === v.owner && p.role === "editor") ?? false;
}

/**
 * Whether a viewer may change a resource's SHARING (visibility, chapter, the
 * people list): owner or admin only. Editors can change content but NOT who
 * can see it — matching Google Docs, where an editor can't publish or re-share
 * unless the owner explicitly allows it. Keeping this separate from canEdit
 * stops "add someone as an editor to help" from silently handing them the
 * power to make the owner's private resource public.
 */
export function canManageSharing(r: Scoped, v: Viewer): boolean {
  return v.admin || r.owner === v.owner;
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
