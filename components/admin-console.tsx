"use client";

/**
 * The admin console's two data views.
 *
 * Both used to be fixtures: Overview rendered four hand-typed numbers
 * ("3,907 Members"), and Users & roles rendered four invented people behind a
 * role dropdown that changed nothing. The dropdown was the worse of the two —
 * roles arrive on HOSA's signed identity token and lib/users writes them from
 * nowhere else, so Vitals cannot change one. An admin who "demoted" someone
 * got a toast and no effect.
 *
 * The real roster was already one fetch away. These read it, and say plainly
 * where the numbers stop being the whole story.
 */

import * as React from "react";

import { deriveAdminStats, statTiles } from "@/lib/admin-stats";
import { initials } from "@/lib/avatar";

import { useRoster, type RosterMember } from "./use-assignments";

/**
 * The caveat lib/users documents and app/api/roster asks the UI to carry:
 * Vitals discovers members one arrival at a time, so these are its own counts,
 * never HOSA's membership.
 */
const LIMITATION =
  "Vitals only counts members who have opened it at least once from the HOSA member platform, so these are not full HOSA membership numbers.";

const ROLE_ORDER: Record<string, number> = { admin: 0, advisor: 1, trainer: 2, student: 3 };

/**
 * Both views below label a roster as the platform: "Members", "Chapters",
 * "N members · roles set in HOSA". That is only true of a roster the server
 * scoped to everyone, and /api/roster does not refuse a non-admin — it answers
 * with a reduced 200 of their own chapter. Rendering that payload was how a
 * student previewing the admin menu read their own classmates as platform-wide
 * health, with "Active this week" pinned at 0 because the reduced shape omits
 * lastSeenAt.
 *
 * The dashboard now gates these views on the signed role, so this should be
 * unreachable. It stays because the check that matters is the one the component
 * makes about its own data: `scope` is the server saying what it just sent, and
 * these labels are wrong for anything but "all".
 */
function requiresFullRoster(scope: string | null): boolean {
  return scope !== "all";
}

function NotPlatformWide() {
  return (
    <div className="empty-state">
      Vitals scoped this roster to a single chapter rather than the whole platform, so these
      figures would be labelled wrong. Platform-wide numbers need an admin session.
    </div>
  );
}

function ago(ms?: number): string {
  if (typeof ms !== "number") return "—";
  const s = Math.max(1, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export function AdminOverview({ documents }: { documents: number }) {
  const { roster, scope, loading, error } = useRoster();
  const tiles = statTiles(deriveAdminStats(roster, documents));

  if (loading) return <div className="empty-state">Loading...</div>;
  if (error) return <div className="empty-state">{error}</div>;
  if (requiresFullRoster(scope)) return <NotPlatformWide />;

  return (
    <section className="role-section">
      <div className="stat-grid">
        {tiles.map((t) => (
          <div key={t.label} className="stat-card">
            <p className="stat-value">{t.value.toLocaleString()}</p>
            <p className="stat-label">{t.label}</p>
          </div>
        ))}
      </div>
      <p className="section-note">{LIMITATION}</p>
    </section>
  );
}

export function AdminUsers() {
  const [roleFilter, setRoleFilter] = React.useState<string>("");
  const { roster, scope, loading, error } = useRoster(roleFilter || undefined);

  const sorted = React.useMemo(
    () =>
      [...roster].sort(
        (a, b) =>
          (ROLE_ORDER[a.role] ?? 99) - (ROLE_ORDER[b.role] ?? 99) || a.name.localeCompare(b.name),
      ),
    [roster],
  );

  return (
    <section className="role-section">
      <div className="section-head">
        <h2>Users &amp; roles</h2>
        {/* The count is a claim about the platform, so it waits for a roster
            that is one. */}
        {!loading && !error && !requiresFullRoster(scope) && (
          <span className="section-count">
            {roster.length} {roster.length === 1 ? "member" : "members"} · roles set in HOSA
          </span>
        )}
      </div>

      <div className="audit-filter" role="tablist" aria-label="Filter by role">
        {[
          { id: "", label: "Everyone" },
          { id: "student", label: "Students" },
          { id: "trainer", label: "Trainers" },
          { id: "advisor", label: "Advisors" },
          { id: "admin", label: "Admins" },
        ].map((r) => (
          <button
            key={r.id || "all"}
            type="button"
            className={roleFilter === r.id ? "on" : ""}
            aria-pressed={roleFilter === r.id}
            onClick={() => setRoleFilter(r.id)}
          >
            {r.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="empty-state">Loading...</div>
      ) : error ? (
        <div className="empty-state">{error}</div>
      ) : requiresFullRoster(scope) ? (
        <NotPlatformWide />
      ) : sorted.length === 0 ? (
        <div className="empty-state">
          {roleFilter ? "Nobody with that role has opened Vitals yet." : LIMITATION}
        </div>
      ) : (
        <div className="table-card">
          {sorted.map((m) => (
            <UserRow key={m.id} m={m} />
          ))}
        </div>
      )}

      {/* Stated rather than implied by a disabled control: a member's role is
          HOSA's to set, and nothing here can override it. */}
      <p className="section-note">
        Roles come from each member&apos;s signed HOSA identity and are read-only here. Change a
        role in the HOSA member platform; it updates the next time they open Vitals.
      </p>
    </section>
  );
}

function UserRow({ m }: { m: RosterMember }) {
  return (
    <div className="member-row">
      <div className="member-id">
        <span className="avatar">{initials(m.name)}</span>
        <div>
          <p className="member-name">{m.name}</p>
          <p className="member-email">{m.chapterName || m.chapter || "No chapter"}</p>
        </div>
      </div>
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <span className={`badge ${m.role === "admin" ? "badge-ok" : "badge-muted"}`}>{m.role}</span>
        <span className="member-frac">{ago(m.lastSeenAt)}</span>
      </div>
    </div>
  );
}
