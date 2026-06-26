/**
 * Demo data for the role-aware dashboard. Vellum has no auth of its own, so the
 * "Viewing as" switcher previews how each HOSA-style role would see the same
 * platform. Documents are real (the store); rosters / assignments / progress /
 * users are illustrative fixtures.
 */

export type Role = "student" | "trainer" | "advisor" | "admin";

export const ROLES: { id: Role; label: string; blurb: string }[] = [
  { id: "student", label: "Student", blurb: "What's assigned to me, and my progress." },
  { id: "trainer", label: "Trainer", blurb: "My content, my roster, and who's done what." },
  { id: "advisor", label: "Advisor", blurb: "My chapter's trainers and students at a glance." },
  { id: "admin", label: "Admin", blurb: "Everyone, everything, and platform health." },
];

export interface AssignedItem {
  id: string;
  title: string;
  kind: "document" | "quiz";
  /** id of a real stored doc to open, when kind === document. */
  docId?: string;
  from: string;
  due: string | null;
  status: "not_started" | "in_progress" | "done";
}

export const STUDENT_ASSIGNMENTS: AssignedItem[] = [
  { id: "a1", title: "Vellum — overview (sample)", kind: "document", docId: "sample", from: "Coach Rivera", due: "Jun 30", status: "in_progress" },
  { id: "a2", title: "Intro to ECG interpretation", kind: "document", docId: "sample", from: "Coach Rivera", due: "Jul 4", status: "not_started" },
  { id: "a3", title: "Anatomy unit 2 quiz", kind: "quiz", from: "Coach Rivera", due: "Jul 2", status: "not_started" },
  { id: "a4", title: "Lab safety briefing", kind: "document", docId: "sample", from: "HOSA Canada", due: null, status: "done" },
];

export interface RosterMember {
  id: string;
  name: string;
  email: string;
  assigned: number;
  done: number;
}

export const TRAINER_ROSTER: RosterMember[] = [
  { id: "m1", name: "Ada Okafor", email: "ada@school.ca", assigned: 4, done: 3 },
  { id: "m2", name: "Liam Tremblay", email: "liam@school.ca", assigned: 4, done: 1 },
  { id: "m3", name: "Priya Nair", email: "priya@school.ca", assigned: 4, done: 4 },
  { id: "m4", name: "Marcus Bell", email: "marcus@school.ca", assigned: 3, done: 0 },
];

export interface ChapterTrainer {
  id: string;
  name: string;
  members: number;
  completion: number; // 0–100
}

export const ADVISOR_TRAINERS: ChapterTrainer[] = [
  { id: "t1", name: "Coach Rivera", members: 12, completion: 74 },
  { id: "t2", name: "Dr. Singh", members: 9, completion: 58 },
  { id: "t3", name: "Ms. Lefebvre", members: 15, completion: 88 },
];

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
