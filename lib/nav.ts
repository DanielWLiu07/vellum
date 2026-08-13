// The member navigation model, shared by the dashboard and by the standalone
// pages that render inside the same shell (upload, profile). Kept out of the
// components so both the sidebar and the dashboard's section validation read
// one definition.

import { ROLES, type Role } from "./demo-data";

// `href` items render as real links (Upload / Profile pages) instead of
// section switches — first-class rows in the same list, same styling.
export type NavItem = { id: string; label: string; soon?: boolean; href?: string };

export const DEFAULT_ROLE: Role = "student";

// The people view of your chapter. Heads every role's menu — it's the one
// surface for everyone in your chapter, so it leads rather than sits with the
// utility links. It is NOT the landing view; see DEFAULT_SECTION.
const CHAPTER_LINK: NavItem = { id: "chapter", label: "My chapter" };

// Every role gets these at the bottom of their section list. Guidelines is
// a real dashboard SECTION (the event-guidelines browser — see
// OfficialGuidelinesView), not an external page, so it keeps the shell.
export const COMMON_LINKS: NavItem[] = [
  { id: "guidelines", label: "Guidelines" },
  { id: "feedback", label: "Feedback" },
  { id: "upload", label: "Upload", href: "/upload" },
  { id: "profile", label: "Profile", href: "/profile" },
];

// Left-nav sections per role. `soon` items are round-2 features (not built yet).
export const NAV: Record<Role, NavItem[]> = {
  student: [
    CHAPTER_LINK,
    { id: "home", label: "Home" },
    { id: "assignments", label: "My assignments" },
    { id: "modules", label: "Modules" },
    { id: "resources", label: "Resources" },
    { id: "quizzes", label: "Quizzes" },
    // Your own exam results. Sits next to Quizzes because that is where you
    // earned them — and it exists because /api/quizzes/[id]/attempts is
    // rightly owner-only (it carries other members' scores), which left the
    // person who sat the exam as the one party who couldn't see their result.
    { id: "results", label: "My results" },
    { id: "skills", label: "General skills" },
    ...COMMON_LINKS,
  ],
  trainer: [
    CHAPTER_LINK,
    { id: "lessons", label: "My lessons" },
    { id: "modules", label: "Modules" },
    { id: "flashcards", label: "Flashcards" },
    { id: "quizzes", label: "Quizzes" },
    // Your own exam results. Sits next to Quizzes because that is where you
    // earned them — and it exists because /api/quizzes/[id]/attempts is
    // rightly owner-only (it carries other members' scores), which left the
    // person who sat the exam as the one party who couldn't see their result.
    { id: "results", label: "My results" },
    { id: "skills", label: "General skills" },
    ...COMMON_LINKS,
  ],
  // An advisor is also a student (some students are advisors), so they get the
  // full student menu plus their advisor-only sections.
  advisor: [
    CHAPTER_LINK,
    { id: "home", label: "Home" },
    { id: "assignments", label: "My assignments" },
    { id: "modules", label: "Modules" },
    { id: "resources", label: "Resources" },
    { id: "quizzes", label: "Quizzes" },
    { id: "results", label: "My results" },
    { id: "lessons", label: "Chapter lessons" },
    { id: "skills", label: "General skills" },
    ...COMMON_LINKS,
  ],
  admin: [
    CHAPTER_LINK,
    { id: "overview", label: "Overview" },
    { id: "users", label: "Users & roles" },
    { id: "modules", label: "Modules" },
    { id: "content", label: "All content" },
    // The queue existed with no way to drain it — held content and no review
    // surface. See components/moderation-view.
    { id: "moderation", label: "Submissions" },
    { id: "access", label: "Roles & access" },
    { id: "activity", label: "Activity log" },
    { id: "settings", label: "Settings" },
    ...COMMON_LINKS,
  ],
};

/**
 * Where each role LANDS, which is deliberately not "the first item in the menu".
 * "My chapter" heads every list for reachability, but opening the dashboard
 * should still put you on your own work. Pinning these by name also means
 * reordering the sidebar can never silently move the landing view.
 */
export const DEFAULT_SECTION: Record<Role, string> = {
  student: "home",
  trainer: "lessons",
  advisor: "home",
  admin: "overview",
};

export function isRole(value: string | undefined | null): value is Role {
  return !!value && ROLES.some((r) => r.id === value);
}

/** The role a `?role=` param asks for, falling back to the default. */
export function roleFromParam(value: string | undefined | null): Role {
  return isRole(value) ? value : DEFAULT_ROLE;
}

/**
 * Resolve a `?section=` param for a role. Only items that are real sections
 * count — `href` rows are separate pages, so `?section=upload` falls back to
 * the role's default section rather than rendering an empty view.
 */
export function sectionFromParam(role: Role, value: string | undefined | null): string {
  const match = NAV[role].find((n) => n.id === value && !n.href);
  return match ? match.id : DEFAULT_SECTION[role];
}
