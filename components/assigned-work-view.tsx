"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { AssignmentParts, partsLabel, partsOf } from "./assignment-parts";
import {
  formatDue,
  KIND_LABEL,
  refHref,
  unassignAssignment,
  useAssignments,
  type Assignment,
} from "./use-assignments";
import { useNames } from "./use-names";

/**
 * What a trainer or advisor has handed out — the other half of "My assignments".
 *
 * Assigning already worked: My chapter puts an Assign button on every member.
 * What was missing was any way to look at the result. A trainer could assign
 * ten things across a chapter and then had no list of what went out, to whom,
 * or what nobody had touched — only a per-member "0/0" counter on the roster,
 * which tells you a total but never which item is stuck.
 *
 * The data was already there and already scoped: GET /api/assignments answers
 * "every assignment in THEIR chapter" for a trainer or advisor and "all of
 * them" for an admin, and it refuses to widen for anyone. This view is a read
 * over that response — it asks for nothing the caller could not already get.
 */

type Filter = "outstanding" | "overdue" | "done" | "all";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "outstanding", label: "Outstanding" },
  { id: "overdue", label: "Overdue" },
  { id: "done", label: "Done" },
  { id: "all", label: "All" },
];

/** Overdue means past due AND not finished. A late-but-done item is done. */
function isOverdue(a: Assignment, now: number): boolean {
  return a.status !== "done" && a.dueAt !== null && a.dueAt < now;
}

function matches(a: Assignment, filter: Filter, now: number): boolean {
  if (filter === "all") return true;
  if (filter === "done") return a.status === "done";
  if (filter === "overdue") return isOverdue(a, now);
  return a.status !== "done";
}

export function AssignedWorkView({ viewQuery = "" }: { viewQuery?: string }) {
  const { assignments, scope, loading, error, reload } = useAssignments();
  const { name, ready } = useNames();
  const [filter, setFilter] = useState<Filter>("outstanding");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Read the clock in an effect, not during render. This component re-renders
  // on the client, so a render-time Date.now() would give two renders different
  // answers about the same row, and the server's clock a third at hydration.
  // Reading it once per data load also means every row in one paint agrees
  // about what "overdue" means.
  //
  // It starts at 0, under which nothing is overdue. That is the safe direction
  // to be wrong in for one frame: the alternative flashes "Overdue" across work
  // that isn't, and a trainer chasing a student about it would be acting on it.
  const [now, setNow] = useState(0);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- clock read is client-only by definition; see above
  useEffect(() => setNow(Date.now()), [assignments]);

  const counts = useMemo(() => {
    let done = 0;
    let overdue = 0;
    for (const a of assignments) {
      if (a.status === "done") done += 1;
      if (isOverdue(a, now)) overdue += 1;
    }
    return { total: assignments.length, done, overdue };
  }, [assignments, now]);

  // Group by member so the question a trainer actually asks — "where is this
  // student at?" — is one glance rather than a scan of a flat list.
  const groups = useMemo(() => {
    const byMember = new Map<string, Assignment[]>();
    for (const a of assignments) {
      if (!matches(a, filter, now)) continue;
      const list = byMember.get(a.assigneeId);
      if (list) list.push(a);
      else byMember.set(a.assigneeId, [a]);
    }
    for (const list of byMember.values()) {
      // Soonest deadline first; undated work sinks below dated work rather
      // than sorting as if it were due at the epoch.
      list.sort((x, y) => (x.dueAt ?? Infinity) - (y.dueAt ?? Infinity));
    }
    return [...byMember.entries()];
  }, [assignments, filter, now]);

  async function onUnassign(a: Assignment) {
    setBusyId(a.id);
    const result = await unassignAssignment(a.id, a.title);
    setBusyId(null);
    setNotice(result.message);
    if (result.ok) await reload();
  }

  return (
    <section className="role-section">
      <div className="section-head">
        <h2>Assigned work</h2>
        <span className="section-count">
          {loading
            ? "loading..."
            : `${counts.total} assigned · ${counts.done} done${
                counts.overdue > 0 ? ` · ${counts.overdue} overdue` : ""
              }`}
        </span>
      </div>

      {/* Say what the list actually contains. The switcher lets anyone open the
          trainer menu, but the API answers by SIGNED role — so a student who
          wanders in here gets their own work, and must not be told they are
          looking at their chapter's. */}
      <p className="section-note">
        {scope === "all"
          ? "Every assignment in Vitals."
          : scope === "chapter"
            ? "Work you and the other staff in your chapter have assigned."
            : "Work assigned to you. Only trainers and advisors can assign."}
      </p>

      <div className="filter-row">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            className={`chip${filter === f.id ? " is-active" : ""}`}
            aria-pressed={filter === f.id}
            onClick={() => setFilter(f.id)}
            data-testid={`assigned-filter-${f.id}`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {notice && (
        <p className="section-note" role="status">
          {notice}
        </p>
      )}

      <div className="tile-grid">
        {error ? (
          <div className="empty-state">{error}</div>
        ) : loading ? (
          <div className="empty-state">Loading assigned work...</div>
        ) : counts.total === 0 ? (
          <div className="empty-state">
            Nothing assigned yet. Open <strong>My chapter</strong> and use
            Assign next to a member.
          </div>
        ) : groups.length === 0 ? (
          <div className="empty-state">
            Nothing matches this filter. {counts.total} assigned in total.
          </div>
        ) : (
          groups.map(([assigneeId, items]) => (
            <div
              key={assigneeId}
              className="assigned-group"
              data-testid={`assigned-group-${assigneeId}`}
            >
              <h3 className="assigned-group-name">
                {/* Until the directory has loaded, an unresolved id is unknown,
                    not missing — saying "Unknown member" then would libel every
                    healthy row on the page. */}
                {ready ? name(assigneeId) : assigneeId}
                <span className="section-count">
                  {items.filter((i) => i.status === "done").length} / {items.length}
                </span>
              </h3>
              <ul className="assigned-list">
                {items.map((a) => {
                  const due = formatDue(a.dueAt);
                  const overdue = isOverdue(a, now);
                  return (
                    <li key={a.id} data-testid={`assigned-item-${a.id}`}>
                      <span className="assigned-title">{a.title}</span>
                      <span className="assigned-meta">
                        {KIND_LABEL[a.kind]}
                        {/* A trainer reviewing what went out has to see WHICH
                            sections went out, or two rows for the same module
                            are indistinguishable here too. */}
                        {partsLabel(a) ? ` · ${partsLabel(a)}` : ""}
                        {due ? ` · due ${due}` : ""}
                        {` · from ${a.assignedByName}`}
                      </span>
                      <AssignmentParts assignment={a} />
                      <span
                        className={`badge ${
                          a.status === "done"
                            ? "badge-ok"
                            : overdue
                              ? "badge-warn"
                              : "badge-muted"
                        }`}
                        data-testid={`assigned-status-${a.id}`}
                      >
                        {a.status === "done"
                          ? "Done"
                          : overdue
                            ? "Overdue"
                            : "Not started"}
                      </span>
                      <span className="assigned-actions">
                        <Link
                          className="btn"
                          href={refHref(a.kind, a.refId, viewQuery, partsOf(a) ?? undefined)}
                        >
                          Open
                        </Link>
                        <button
                          type="button"
                          className="btn"
                          disabled={busyId === a.id}
                          onClick={() => void onUnassign(a)}
                          data-testid={`assigned-unassign-${a.id}`}
                        >
                          {busyId === a.id ? "Removing..." : "Unassign"}
                        </button>
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
