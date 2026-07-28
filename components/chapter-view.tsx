"use client";

import { useEffect, useMemo } from "react";

import { initials } from "@/lib/avatar";

import { useMe, useRoster, type RosterMember } from "./use-assignments";

/** Roles the server lets hand work out — mirrors canAssign in lib/users. */
function canAssign(role?: string): boolean {
  return role === "trainer" || role === "advisor" || role === "admin";
}

/**
 * Completion counts come from the server. They're absent on a reduced roster,
 * and absent is not zero — render nothing rather than an honest-looking 0/0.
 */
function Progress({ done, assigned }: { done?: number; assigned?: number }) {
  if (typeof done !== "number" || typeof assigned !== "number") return null;
  const pct = assigned === 0 ? 0 : Math.round((done / assigned) * 100);
  return (
    <div className="member-progress">
      <div className="bar" aria-label={`${pct}%`}><div className="bar-fill" style={{ width: `${pct}%` }} /></div>
      <span className="member-frac">{done}/{assigned}</span>
    </div>
  );
}

const LIMITATION =
  "Only members who have opened Vitals at least once from the HOSA member platform appear here.";

/**
 * The one people surface in Vitals: who is in your chapter, what they've been
 * assigned, and — for teaching roles — the way to assign more. It replaces the
 * three near-duplicate rosters that used to sit in the trainer, advisor and
 * admin menus: same data, one place, adapting to who's looking.
 *
 * What a viewer gets is decided by the SERVER's answer, never the previewed
 * role. `scope: "all"` (admin, who has no chapter of their own) groups everyone
 * by chapter; a chapter scope lists that chapter; a refusal is explained rather
 * than rendered as an empty page.
 */
export function ChapterView({ refreshToken, onAssign }: {
  refreshToken: number;
  onAssign: (member: RosterMember) => void;
}) {
  const me = useMe();
  const { roster, scope, loading, error, errorCode, reload } = useRoster();

  useEffect(() => {
    if (refreshToken > 0) void reload();
  }, [refreshToken, reload]);

  const mayAssign = canAssign(me?.role);
  const isAllScope = scope === "all";

  // Grouped by chapter ID, labelled with the name. Keying on the id is what
  // keeps a chapter rename from splitting or orphaning a roster; the label is
  // read off the group's members, so a missing name (legacy token) shows the id.
  const groups = useMemo(() => {
    if (!isAllScope) return [];
    const byChapter = new Map<string, RosterMember[]>();
    for (const m of roster) {
      const key = m.chapter || "";
      const list = byChapter.get(key);
      if (list) list.push(m);
      else byChapter.set(key, [m]);
    }
    return [...byChapter.entries()]
      .map(([id, members]) => ({
        id,
        label: members.find((m) => m.chapterName)?.chapterName || id,
        members,
      }))
      // Chapter-less members sort last, under their own heading.
      .sort((a, b) => (a.id ? a.label : "￿").localeCompare(b.id ? b.label : "￿"));
  }, [roster, isAllScope]);

  // `chapter` is the id (the scoping key); `chapterName` is display-only. Never
  // collapse them — filtering or grouping by name breaks on a rename.
  const heading = isAllScope ? "All chapters" : me?.chapterName || me?.chapter || "My chapter";

  function Row({ m }: { m: RosterMember }) {
    const isSelf = !!me && m.id === me.id;
    return (
      <div className="member-row">
        <div className="member-id">
          <span className="avatar">{initials(m.name)}</span>
          <div>
            <p className="member-name">{m.name}{isSelf ? " (you)" : ""}</p>
            <p className="member-email">{m.role}</p>
          </div>
        </div>
        {/* Teaching roles see everyone's progress; everyone sees their own. */}
        {(mayAssign || isSelf) && <Progress done={m.done} assigned={m.assigned} />}
        {mayAssign && !isSelf && (
          <button className="btn primary" onClick={() => onAssign(m)}>Assign</button>
        )}
      </div>
    );
  }

  if (error) {
    return (
      <section className="role-section">
        <div className="section-head"><h2>{heading}</h2></div>
        <div className="empty-state">
          {/* A 403 here isn't the role-preview story the generic message tells:
              the roster is currently limited to teaching roles. */}
          {errorCode === "forbidden"
            ? "The chapter directory isn't open to your account yet — right now it's limited to trainers, advisors, and admins. This fills in once student access is enabled."
            : error}
        </div>
      </section>
    );
  }

  if (loading) {
    return (
      <section className="role-section">
        <div className="section-head"><h2>{heading}</h2><span className="section-count">loading...</span></div>
        <div className="empty-state">Loading your chapter...</div>
      </section>
    );
  }

  // Someone with no chapter on their identity has no chapter view. An admin
  // does, so this only applies once we know the scope isn't "all".
  if (me && !me.chapter && !isAllScope) {
    return (
      <section className="role-section">
        <div className="section-head"><h2>My chapter</h2></div>
        <div className="empty-state">
          Your HOSA account isn&apos;t linked to a chapter yet, so there&apos;s no chapter to show.
          Ask your advisor to set your chapter on the HOSA member platform, then reopen Vitals.
        </div>
      </section>
    );
  }

  return (
    <section className="role-section">
      <div className="section-head">
        <h2>{heading}</h2>
        <span className="section-count">
          {roster.length} {roster.length === 1 ? "member" : "members"}
          {isAllScope ? ` · ${groups.length} ${groups.length === 1 ? "chapter" : "chapters"}` : ""}
        </span>
      </div>
      {roster.length === 0 ? (
        <div className="empty-state">
          Nobody here yet. {LIMITATION} An empty list doesn&apos;t mean an empty chapter.
        </div>
      ) : isAllScope ? (
        <>
          {groups.map((g) => (
            <div key={g.id || "none"} style={{ marginBottom: 18 }}>
              <p className="upload-settings-title">{g.id ? g.label : "No chapter set"}</p>
              <div className="table-card">
                {g.members.map((m) => <Row key={m.id} m={m} />)}
              </div>
            </div>
          ))}
          <p className="dash-sub">{LIMITATION}</p>
        </>
      ) : (
        <>
          <div className="table-card">
            {roster.map((m) => <Row key={m.id} m={m} />)}
          </div>
          <p className="dash-sub" style={{ marginTop: 12 }}>{LIMITATION}</p>
        </>
      )}
    </section>
  );
}
