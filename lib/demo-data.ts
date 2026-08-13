/**
 * Demo data for the role-aware dashboard. The "Viewing as" switcher previews how
 * each HOSA-style role would see the same platform; the SERVER still decides
 * permissions from the session.
 *
 * Documents, assignments, and the roster are real now (lib/assignments +
 * lib/users, via /api/assignments and /api/roster). What's left here is
 * illustrative: chapter info, the platform stat tiles, and the users/roles
 * table, which has no endpoint behind it yet.
 */

export type Role = "student" | "trainer" | "advisor" | "admin";

export const ROLES: { id: Role; label: string; blurb: string }[] = [
  { id: "student", label: "Student", blurb: "What's assigned to me, and my progress." },
  { id: "trainer", label: "Trainer", blurb: "My content, my roster, and who's done what." },
  { id: "advisor", label: "Advisor", blurb: "My chapter's trainers and students at a glance." },
  { id: "admin", label: "Admin", blurb: "Everyone, everything, and platform health." },
];

// Nothing illustrative is left in this file, and that is deliberate.
//
// CHAPTER put "Toronto Central", advisor "Coach Rivera" and a "confirm your
// events by Oct 20" deadline on the home page of every member in every
// chapter. ADMIN_USERS and ADMIN_STATS did the same for the admin console —
// four invented people and four typed-in totals ("3,907 Members").
//
// All three now read the signed session and the real roster
// (components/chapter-summary, components/admin-console). They are deleted
// rather than left here, so nothing can be wired back in by mistake. Fields
// with no source in Vitals — chapter region, next event, announcements — were
// dropped, not replaced: HOSA owns that data and there is no feed for it yet.
