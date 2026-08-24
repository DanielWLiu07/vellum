"use client";

/**
 * To do — everything outstanding for whoever is signed in, in one place.
 *
 * Before this, "what do I actually have to do" was spread across three
 * surfaces and one of them didn't exist: assigned work lived under My
 * assignments, exams you had never sat lived under Examinations behind a
 * "Not yet sat" tab you had to go looking for, and nothing anywhere put the
 * two together. A member with an exam closing tonight and an overdue reading
 * had to visit two sections to learn it.
 *
 * GROUPED, NOT SORTED. The sections are separate on purpose. One list sorted
 * by date reads as a queue you work top to bottom, which is exactly wrong when
 * the top item is overdue and the second closes in an hour — the reader has to
 * re-derive urgency from dates. Separate headed sections state it.
 *
 * Vitals still has NO notification system (§13.1): nothing here is pushed to
 * anyone. This section is the compensating control — it is the surface a
 * member checks, so it must be complete and honest rather than pretty.
 */

import Link from "next/link";
import * as React from "react";

import type { QuizMeta } from "@/lib/quizzes";
import type { MyQuizHistory } from "@/lib/quiz-history";

import { buildTodo, todoCount, type TodoItem, type TodoSection } from "@/lib/todo";

import { AssignmentParts, partsLabel, partsOf } from "./assignment-parts";
import {
  formatDue,
  refHref,
  setAssignmentStatus,
  useAssignments,
  useMe,
} from "./use-assignments";

/**
 * The grouping rules live in lib/todo.ts (pane 3) — pure, tested, and clock-free
 * by design. This file does every fetch, shapes the two reads into that
 * contract, and renders what comes back. Deciding priority here as well would
 * have given the same question two answers.
 */

export function TodoView({ viewQuery }: { viewQuery: string }) {
  const me = useMe();
  const { assignments, loading: loadingAssignments, error: assignmentsError, reload } =
    useAssignments(me?.id, !!me);

  const [exams, setExams] = React.useState<QuizMeta[]>([]);
  const [history, setHistory] = React.useState<MyQuizHistory[]>([]);
  // The clock is read ONCE, when the data lands, and kept in state. Reading it
  // during render is a React Compiler purity violation (§12.8), and it would
  // also mean "overdue" could change mid-render.
  const [now, setNow] = React.useState<number | null>(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [flash, setFlash] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    const [qRes, hRes] = await Promise.all([
      fetch("/api/quizzes", { cache: "no-store" }).catch(() => null),
      fetch("/api/my-attempts", { cache: "no-store" }).catch(() => null),
    ]);
    const qJson = qRes?.ok ? await qRes.json().catch(() => null) : null;
    const hJson = hRes?.ok ? await hRes.json().catch(() => null) : null;
    // Resolved after an await, so this is not a cascading render.
    if (Array.isArray(qJson?.quizzes)) setExams(qJson.quizzes);
    if (Array.isArray(hJson?.quizzes)) setHistory(hJson.quizzes);
    setNow(Date.now());
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  React.useEffect(() => { void load(); }, [load]);

  // lib/todo ids an assignment item by the assignment's own id, so the record
  // is recoverable for the fields the rule module doesn't carry (parts).
  const assignmentFor = (item: TodoItem) =>
    item.kind === "assignment" ? assignments.find((x) => x.id === item.id) : undefined;

  const hrefFor = (item: TodoItem) => {
    const a = assignmentFor(item);
    return a
      ? refHref(a.kind, a.refId, viewQuery, partsOf(a) ?? undefined)
      : `${item.href}${viewQuery}`;
  };

  async function markDone(item: TodoItem) {
    // Only assigned work has a status to flip; an unsat exam is finished by
    // sitting it, not by ticking it. lib/todo ids an assignment by its own id.
    if (item.kind !== "assignment") return;
    const a = assignments.find((x) => x.id === item.id);
    if (!a) return;
    setBusyId(item.id);
    const res = await setAssignmentStatus(a.id, a.title, "done");
    setBusyId(null);
    setFlash(res.message);
    if (res.ok) await reload();
  }

  const ready = now !== null && !loadingAssignments;

  // Shape /api/quizzes + /api/my-attempts into lib/todo's TodoExam.
  // `countedAttempts` is the load-bearing field: 0 means still owed, and it
  // comes from MyQuizHistory.counted, which already excludes voided sittings.
  // An exam with no history row has never been sat, so 0 is right for it too.
  // A CLOSED exam is dropped — it cannot be sat any more, and listing work
  // nobody can do is worse than omitting it.
  const todoExams = React.useMemo(
    () =>
      exams
        // Only exams that can be sat RIGHT NOW. A closed one can never be done
        // again; one that hasn't opened cannot be done yet, and its Open button
        // would land on the 403 the take route rightly returns. Listing either
        // as a to-do is telling someone to do the impossible — Examinations is
        // where an upcoming sitting is announced, with the date on it.
        .filter((e) => e.isExam && (e.examWindow ?? "open") === "open")
        .map((e) => {
          const h = history.find((x) => x.quizId === e.id);
          return {
            quizId: e.id,
            title: e.title,
            dueAt: e.examClosesAt ?? null,
            countedAttempts: h?.counted ?? 0,
            totalAttempts: h?.attempts.length ?? 0,
          };
        }),
    [exams, history],
  );

  const sections: TodoSection[] = ready
    ? buildTodo({ now: now!, assignments, exams: todoExams })
    : [];
  const total = todoCount(sections);

  return (
    <section className="role-section">
      <div className="section-head">
        <h2>To do</h2>
        {ready && total > 0 && (
          <span className="section-count">{total} outstanding</span>
        )}
      </div>
      <p className="dash-sub" style={{ marginTop: -4, marginBottom: 12 }}>
        Everything still open for you — work a trainer assigned, and exams you haven&apos;t sat.
        Grouped by how urgent it is, not by when it arrived.
      </p>
      {flash && <p className="dash-sub" role="status" style={{ marginBottom: 12 }}>{flash}</p>}

      {assignmentsError && <div className="empty-state">{assignmentsError}</div>}

      {!ready ? (
        <div className="empty-state">Loading...</div>
      ) : total === 0 ? (
        <div className="empty-state">
          Nothing outstanding. Assigned work and exams you haven&apos;t sat show up here.
        </div>
      ) : (
        sections.map((s) => (
          <div key={s.priority} className={`todo-group is-${s.priority}`}>
            <div className="todo-group-head">
              <h3 className="todo-group-title">{s.label}</h3>
              <span className="todo-group-count">{s.items.length}</span>
            </div>
            <div className="table-card">
              {s.items.map((item) => (
                <div key={item.id} className="member-row">
                  <div className="member-id">
                    <div>
                      <p className="member-name">{item.title}</p>
                      <p className="member-email">
                        {item.meta}
                        {partsLabel(assignmentFor(item)) ? ` · ${partsLabel(assignmentFor(item))}` : ""}
                        {formatDue(item.dueAt) ? `${item.meta ? " · " : ""}due ${formatDue(item.dueAt)}` : ""}
                      </p>
                      <AssignmentParts assignment={assignmentFor(item)} />
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    {/* lib/todo builds a bare path and cannot see `parts`, so
                        a narrowed module would open at section 1 here while the
                        assignment card opens at the right one. Rebuild it from
                        the record for assignment rows; exam rows keep theirs. */}
                    <Link className="btn primary" href={hrefFor(item)}>Open</Link>
                    {item.kind === "assignment" && (
                      <button
                        type="button"
                        className="btn"
                        disabled={busyId === item.id}
                        onClick={() => void markDone(item)}
                      >
                        {busyId === item.id ? "Saving..." : "Mark done"}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))
      )}
    </section>
  );
}
