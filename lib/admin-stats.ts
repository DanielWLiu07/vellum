/**
 * Derived figures for the admin overview.
 *
 * Every number here counts what VITALS has seen, not what HOSA has. Vitals
 * keeps no user table: lib/users records a member the first time they arrive
 * carrying a signed identity, so a student who has never followed the handoff
 * link is invisible. The overview has to say that out loud — otherwise "40
 * members" reads as the size of the organisation when it is the size of the
 * sample, and the old hardcoded "3,907" was wrong in exactly that direction.
 *
 * Structural input types rather than an import from components: this stays a
 * leaf module so the UI depends on it and never the reverse.
 */

/** The roster fields these counts need. Matches /api/roster's admin payload. */
export interface CountableMember {
  /** Chapter ID — the grouping key. Never the display name. */
  chapter: string;
  role: string;
  /** Absent on a reduced roster, so activity is counted, never assumed. */
  lastSeenAt?: number;
}

export interface AdminStats {
  members: number;
  students: number;
  trainers: number;
  advisors: number;
  admins: number;
  /** Distinct chapters represented. Admins carry no chapter, so blanks don't count. */
  chapters: number;
  documents: number;
  /** Members seen within the window — the only real liveness signal available. */
  activeRecently: number;
}

export const ACTIVE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export function deriveAdminStats(
  roster: readonly CountableMember[],
  documents: number,
  now: number = Date.now(),
): AdminStats {
  const chapters = new Set<string>();
  let students = 0;
  let trainers = 0;
  let advisors = 0;
  let admins = 0;
  let activeRecently = 0;

  for (const m of roster) {
    // An admin has no chapter of their own, and a legacy token can carry an
    // empty one. Either way "" is not a chapter and must not inflate the count.
    if (m.chapter) chapters.add(m.chapter);
    if (m.role === "student") students++;
    else if (m.role === "trainer") trainers++;
    else if (m.role === "advisor") advisors++;
    else if (m.role === "admin") admins++;
    // Absent lastSeenAt means "not reported", which is not "not active" —
    // counting it either way would be inventing data.
    if (typeof m.lastSeenAt === "number" && now - m.lastSeenAt <= ACTIVE_WINDOW_MS) {
      activeRecently++;
    }
  }

  return {
    members: roster.length,
    students,
    trainers,
    advisors,
    admins,
    chapters: chapters.size,
    documents,
    activeRecently,
  };
}

/**
 * The overview tiles, in display order. Derived rather than hand-listed in the
 * component so the labels and the arithmetic can't drift apart.
 */
export function statTiles(s: AdminStats): { label: string; value: number }[] {
  return [
    { label: "Members", value: s.members },
    { label: "Active this week", value: s.activeRecently },
    { label: "Chapters", value: s.chapters },
    { label: "Documents", value: s.documents },
    { label: "Students", value: s.students },
    { label: "Trainers", value: s.trainers },
    { label: "Advisors", value: s.advisors },
    { label: "Admins", value: s.admins },
  ];
}
