/**
 * Resource visibility scopes and the access checks over them, shared by the API
 * routes, the create forms, and the dashboard filters. Pure — no I/O, no
 * request context — so the same rules run on the client and the server.
 *
 * THE VIEWER IS REAL. Every function here takes the viewer as an argument, and
 * every caller supplies it from the signed HOSA session: routes through
 * lib/profile.getViewer(), the client through components/use-viewer. Nothing in
 * this file falls back to a demo identity. One used to live here, and the
 * tombstone further down records what believing in it cost.
 *
 * That header previously said the opposite, which mattered because of what this
 * file is: canView, canEdit and canManageSharing ARE the access rules, not a
 * convenience for the UI. A maintainer who reads "the current viewer is a demo
 * identity" before editing one of them has been told the checks are theatre.
 *
 * The other thing to know before touching anything here: `Viewer.owner`,
 * `Scoped.owner` and `chapter` are HOSA identity ids (cuids). They are for
 * comparing, never for displaying — see makeNameResolver and chapterLabel
 * below, which exist because several surfaces printed them raw.
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

/**
 * `person` is an IDENTITY, not a name.
 *
 * canView and canEdit compare it against Viewer.owner, which is the HOSA `sub`
 * — a cuid. The share dialog used to collect it from a free-text "Add people by
 * name" box, so every grant it wrote ("Jane Smith") could never match anyone,
 * and the UI still reported "Shared with 1 person". Grants are now picked from
 * the roster, which is the only place ids come from. The helpers below exist so
 * the dialog can show names while storing ids.
 */
export interface Scoped {
  visibility: Visibility;
  chapter: string;
  owner: string;
  /** Direct grants; checked in addition to the visibility scope. */
  people?: PersonShare[];
}

/** A member as the roster knows them: the id to store, the name to show. */
export interface DirectoryMember {
  id: string;
  name: string;
  role?: string;
}

export interface ResolvedGrant extends PersonShare {
  /** What to show for this grant. */
  label: string;
  /** Whether the directory could account for the id at all. */
  known: boolean;
}

/**
 * Pair stored grants with the directory so the dialog can render names.
 *
 * An unknown id is surfaced, not hidden. Two very different things land here:
 * a legacy free-text grant from the old box (dead — it can never match a
 * viewer), and a real id the current roster doesn't cover (a member of another
 * chapter, since a non-admin's roster is chapter-scoped). The dialog can't tell
 * them apart and must not guess, so `known: false` means only "not in this
 * roster" and the wording it drives has to stay that vague. Dropping unknown
 * rows would be worse than either: the owner would have no way to clear a dead
 * grant they can't see.
 */
export function resolveGrants(
  people: readonly PersonShare[] | undefined,
  directory: readonly DirectoryMember[],
): ResolvedGrant[] {
  return (people ?? []).map((p) => ({
    ...p,
    label: memberName(p.person, directory),
    known: directory.some((m) => m.id === p.person),
  }));
}

export type NameResolver = (id: string) => string;

/**
 * Build an id-to-name lookup once and reuse it per row.
 *
 * Bylines are the reason this is a factory rather than a per-call scan: a
 * thread renders one lookup per comment against a roster of every member in
 * the chapter, and that is a quadratic scan on every keystroke in the comment
 * box. Callers memoize the returned function on the directory.
 *
 * Later entries win, so a caller can append its own session after the roster
 * and have its own name take precedence over a stale row about itself.
 */
export function makeNameResolver(directory: readonly DirectoryMember[]): NameResolver {
  const names = new Map<string, string>();
  // A blank name is not an override. Skipping it here means a directory row
  // that knows an id but not a name can't blank out a good name from earlier.
  for (const m of directory) if (m.name.trim()) names.set(m.id, m.name.trim());
  return (id) => names.get(id) || id;
}

/**
 * What to print for an id. Returns the id itself when nothing can name it —
 * deliberately, because the alternative is a blank space where a person's name
 * should be, and an owner deciding who to remove needs SOMETHING to go on.
 *
 * Falling back to the id rather than to "Unknown member" is the important part:
 * a non-admin's roster only covers their own chapter, so someone from another
 * chapter is legitimately unresolvable here. A placeholder would render that
 * ordinary case identically to a stale roster and to a deleted account.
 */
export function memberName(id: string, directory: readonly DirectoryMember[]): string {
  return makeNameResolver(directory)(id);
}

/** Anything that carries a chapter id and, optionally, its display name. */
export interface ChapterNamed {
  chapter: string;
  chapterName?: string;
}

/**
 * Display name for a chapter id.
 *
 * lib/users is blunt that the id is a cuid and must never be rendered — but a
 * dialog that shows nothing at all about who "Chapter only" means is how an
 * editable chapter box got here in the first place: it looked like garbage, so
 * someone tidied it into a readable name and scoped the resource to nobody.
 * Falling back to the raw id when no one knows the name is intentional. An
 * unfamiliar string reads as "don't touch this"; a confident guess would not.
 */
export function chapterLabel(chapterId: string, known: readonly ChapterNamed[]): string {
  if (!chapterId) return "";
  const named = known.find((k) => k.chapter === chapterId && k.chapterName?.trim());
  return named?.chapterName?.trim() || chapterId;
}

/**
 * Roster members still addable, narrowed by what the owner has typed.
 *
 * Order is left alone: /api/roster already sorts by name (listKnownUsers), and
 * re-sorting here would quietly fight it. The id is searchable as well as the
 * name so an admin who has an id in hand can paste it, but a member with no id
 * is dropped outright rather than offered as an unstorable row.
 */
export function candidateMembers(
  members: readonly DirectoryMember[],
  query: string,
  opts: { exclude?: readonly string[]; owner?: string } = {},
): DirectoryMember[] {
  const taken = new Set(opts.exclude ?? []);
  const q = query.trim().toLowerCase();
  return members.filter((m) => {
    if (!m.id || m.id === opts.owner || taken.has(m.id)) return false;
    if (!q) return true;
    return m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q);
  });
}

export interface Viewer {
  owner: string;
  chapter: string;
  admin: boolean;
}

// DEMO_VIEWER lived here — a hardcoded { owner: "you", chapter: "Toronto
// Central" } that the whole Resources UI passed into canEdit, canManageSharing
// and filterScoped. Against a real session none of it matched, so the "Mine"
// tab was always empty and Edit/Share/Delete never appeared on your own files.
// The client now derives the viewer from the session (components/use-viewer),
// so there is nothing left to hardcode.

export function normalizeVisibility(v: unknown): Visibility {
  return v === "chapter" || v === "private" ? v : "public";
}

export const MAX_PEOPLE = 20;
const PERSON_MAX = 60;

/**
 * Validate an untrusted people list into a clean PersonShare[]: objects only,
 * trimmed/clamped ids, viewer|editor roles, no duplicates (last entry wins, so
 * re-adding someone updates their role), capped at MAX_PEOPLE.
 *
 * `owner` DROPS THE OWNER FROM THE LIST, AND IS NOT AN INVARIANT OF STORED
 * DATA. The PATCH routes pass it, but resource-share.setShare re-normalizes
 * without it before writing — and setShare is the last word, so an owner can
 * end up in their own people list. Sharing sidecars don't record who owns the
 * resource (the owner lives on the doc/deck/quiz), so setShare has nothing to
 * pass; making this a real invariant means threading the owner into setShare,
 * not adding another call site here.
 *
 * It is a tidiness measure, not a security one, and nothing should be built on
 * top of it. Access never depends on the owner's absence: canView and canEdit
 * both return on `r.owner === v.owner` before the people list is consulted, so
 * a self-grant hands the owner nothing they don't already have. The visible
 * cost is cosmetic — a share dialog listing the owner twice, once as Owner and
 * once as a grant.
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
