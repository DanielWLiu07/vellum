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

export interface ChapterInfo {
  name: string;
  region: string;
  advisor: string;
  members: number;
  nextEvent: { name: string; date: string };
  announcement: string;
}

export const CHAPTER: ChapterInfo = {
  name: "Toronto Central",
  region: "HOSA Canada - Ontario",
  advisor: "Coach Rivera",
  members: 38,
  nextEvent: { name: "Fall Leadership Conference (online)", date: "Nov 14" },
  announcement: "FLC registration is open. Confirm your competitive events with your advisor by Oct 20.",
};

export interface AdminUser {
  id: string;
  name: string;
  email: string;
  role: Role;
}

export const ADMIN_USERS: AdminUser[] = [
  { id: "u1", name: "Coach Rivera", email: "rivera@school.ca", role: "trainer" },
  { id: "u2", name: "Ms. Lefebvre", email: "lefebvre@school.ca", role: "advisor" },
  { id: "u3", name: "Ada Okafor", email: "ada@school.ca", role: "student" },
  { id: "u4", name: "Daniel Liu", email: "daniel@hosacanada.org", role: "admin" },
];

export const ADMIN_STATS = [
  { label: "Documents", value: "1,284" },
  { label: "Members", value: "3,907" },
  { label: "Trainers", value: "112" },
  { label: "Chapters", value: "48" },
];
