// Where a flow sends you when you're done with it.
//
// Every page you can *finish* or *leave* — take a quiz, study a deck, work
// through a module, edit any of them, upload a file — carries the place it was
// opened from in a `?back=` param, and falls back to a per-flow default when
// there isn't one. The document viewer pioneered the pattern (its "Dashboard"
// link restores the exact role + section you left); this is the generalized
// version with the validation tightened, so every flow behaves the same way.
//
// Explicit targets rather than history.back(): a member who deep-linked into a
// quiz, or refreshed halfway through, has no useful history entry, and "back"
// would either dead-end or re-enter the flow they just left.
//
// SAFETY: a resolved target is REBUILT from validated pieces — allowlisted
// route shape, allowlisted query keys, every value re-checked — instead of
// echoed through. A crafted `?back=` can only ever name a page inside this app,
// so the return links can't be turned into an open redirect, and no query value
// the destination didn't anticipate survives the round trip.

import { NAV, isRole } from "./nav";

/** Longest `?back=` worth parsing — real targets are well under this. */
const MAX_LENGTH = 512;
/** Nested hops that survive: list -> editor -> preview is depth 2. */
const MAX_DEPTH = 3;
/** Path ids are opaque handles (`q_<uuid>`, `sample-quiz`), nothing else. */
const ID = /^[A-Za-z0-9_-]{1,64}$/;
/** Parsing base for path-only inputs; never appears in a returned value. */
const BASE = "http://return.invalid";

/** Route shapes you can be sent back to. "*" is an id segment. */
const ROUTES: readonly (readonly string[])[] = [
  ["dashboard"],
  ["upload"],
  ["profile"],
  ["view", "*"],
  ["quizzes", "*"],
  ["quizzes", "*", "edit"],
  ["quizzes", "*", "attempts"],
  ["decks", "*"],
  ["decks", "*", "edit"],
  ["modules", "*"],
  ["modules", "*", "edit"],
];

/** Dashboard section id -> its sidebar label, for return-link wording. */
const SECTIONS = new Map<string, string>();
for (const items of Object.values(NAV)) {
  for (const item of items) if (!item.href && !SECTIONS.has(item.id)) SECTIONS.set(item.id, item.label);
}

/** The per-flow defaults: where a flow lands when it wasn't told otherwise. */
export const RETURN_TO = {
  dashboard: "/dashboard",
  quizzes: "/dashboard?section=quizzes",
  flashcards: "/dashboard?section=flashcards",
  modules: "/dashboard?section=modules",
  resources: "/dashboard?section=resources",
} as const;

const CONTENT_TYPES = new Set(["document", "flashcards", "quiz"]);

/**
 * Query params a return target may carry, each with its own check. Anything
 * else is dropped: `?section=` restores where the member was standing, it is
 * not a channel for arbitrary state.
 */
const QUERY: Record<string, (value: string, depth: number) => string | null> = {
  role: (v) => (isRole(v) ? v : null),
  section: (v) => (SECTIONS.has(v) ? v : null),
  type: (v) => (CONTENT_TYPES.has(v) ? v : null),
  mode: (v) => (v === "slides" || v === "scroll" ? v : null),
  // A target can name its own target (finish the preview -> back to the editor
  // -> back to the list). Same validation, one level down, so a chain can't be
  // used to smuggle a path the shallow check would have rejected.
  back: (v, depth) => (depth < MAX_DEPTH ? parse(v, depth + 1) : null),
};
const QUERY_KEYS = ["role", "section", "type", "mode", "back"] as const;

function matchesRoute(segments: string[]): boolean {
  return ROUTES.some(
    (route) =>
      route.length === segments.length &&
      route.every((part, i) => (part === "*" ? ID.test(segments[i]!) : part === segments[i])),
  );
}

function parse(raw: unknown, depth: number): string | null {
  if (typeof raw !== "string") return null; // absent, or a repeated ?back= (string[])
  if (raw.length === 0 || raw.length > MAX_LENGTH) return null;
  if (raw[0] !== "/" || raw[1] === "/") return null; // in-app absolute path; never protocol-relative
  if (raw.includes("\\")) return null; // browsers fold \ into / — "/\evil.example" is off-origin
  if (/[\u0000-\u001f\u007f]/.test(raw)) return null; // control characters (log / header smuggling)

  let url: URL;
  try {
    url = new URL(raw, BASE);
  } catch {
    return null;
  }
  if (url.origin !== BASE) return null; // belt and braces: nothing resolved off-origin

  // URL normalization has already collapsed "." / ".." segments (percent-encoded
  // ones included), so what's left is the real path.
  const segments = url.pathname.split("/").filter(Boolean);
  if (!matchesRoute(segments)) return null;

  const params = new URLSearchParams();
  for (const key of QUERY_KEYS) {
    const values = url.searchParams.getAll(key);
    if (values.length !== 1) continue; // absent, or repeated and therefore ambiguous
    const value = QUERY[key]!(values[0]!, depth);
    if (value !== null) params.set(key, value);
  }
  const query = params.toString();
  return `/${segments.join("/")}${query ? `?${query}` : ""}`;
}

/**
 * A `?back=` value if it names a real in-app destination, else null. Use this
 * where the default depends on something only the caller knows (the upload
 * page picks its default from the tab you're on).
 */
export function readReturn(raw: string | string[] | null | undefined): string | null {
  return parse(raw, 0);
}

/**
 * The destination a flow should send you to: the requested one when it survives
 * validation, otherwise the flow's own default.
 */
export function resolveReturn(raw: string | string[] | null | undefined, fallback: string): string {
  return parse(raw, 0) ?? parse(fallback, 0) ?? RETURN_TO.dashboard;
}

/** Point a link INTO a flow at where it should come back to. */
export function withBack(href: string, back: string | null | undefined): string {
  const target = parse(back, 0);
  if (!target) return href;
  return `${href}${href.includes("?") ? "&" : "?"}back=${encodeURIComponent(target)}`;
}

/** The dashboard, back on the role + section the member was looking at. */
export function dashboardReturn(role: string | null | undefined, section: string | null | undefined): string {
  const params = new URLSearchParams();
  if (isRole(role)) params.set("role", role);
  if (section && SECTIONS.has(section)) params.set("section", section);
  const query = params.toString();
  return `/dashboard${query ? `?${query}` : ""}`;
}

/**
 * What to call the way out, so every flow reads the same: "← Quizzes",
 * "← Modules", "← Quiz editor". Dashboard sections borrow the sidebar's own
 * wording, so the link names the row it highlights.
 */
export function returnLabel(target: string): string {
  const resolved = parse(target, 0);
  if (!resolved) return "Dashboard";
  const [path, query = ""] = resolved.split("?");
  const segments = path!.split("/").filter(Boolean);
  const [head, , third] = segments;
  switch (head) {
    case "upload":
      return "Add content";
    case "profile":
      return "Profile";
    case "view":
      return "Document";
    case "quizzes":
      return third === "edit" ? "Quiz editor" : third === "attempts" ? "Exam attempts" : "Quiz";
    case "decks":
      return third === "edit" ? "Deck editor" : "Deck";
    case "modules":
      return third === "edit" ? "Module editor" : "Module";
    default: {
      const section = new URLSearchParams(query).get("section");
      return (section && SECTIONS.get(section)) || "Dashboard";
    }
  }
}
