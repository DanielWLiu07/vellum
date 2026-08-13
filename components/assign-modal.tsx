"use client";

import { useEffect, useState } from "react";

import {
  assignContent,
  formatDue,
  KIND_LABEL,
  unassignAssignment,
  useAssignments,
  type AssignmentKind,
} from "./use-assignments";
import { useModal } from "./use-modal";

/** Modules lead: handing a member an official HOSA module is the main use case. */
const KINDS: AssignmentKind[] = ["module", "doc", "deck", "quiz"];

interface Choice {
  id: string;
  title: string;
}

/**
 * Assign content to one member, and take it back. Everything here goes through
 * the API, so a refusal (wrong chapter, not really a trainer) surfaces as a
 * toast instead of a button that silently does nothing.
 */
export function AssignModal({ member, docs, onClose, onChanged, notify }: {
  member: { id: string; name: string };
  docs: { id: string; name: string }[];
  onClose: () => void;
  onChanged: () => void;
  notify: (msg: string) => void;
}) {
  const ref = useModal(onClose);
  const [kind, setKind] = useState<AssignmentKind>("module");
  const [due, setDue] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [lists, setLists] = useState<Record<AssignmentKind, Choice[]> | null>(null);
  // Which kinds could not be fetched, as opposed to came back empty. Tracked
  // per kind because one endpoint failing says nothing about the others.
  const [failedKinds, setFailedKinds] = useState<Set<AssignmentKind>>(new Set());
  // What this member already has — the same list the API will refuse to
  // duplicate, and where Unassign lives.
  const { assignments, loading: loadingAssigned, error: assignedError, reload } = useAssignments(member.id);

  useEffect(() => {
    let live = true;
    void (async () => {
      // null means the fetch failed, which is NOT the same as an empty list.
      // Collapsing the two sent a failure out as "No module content to assign
      // yet", and a trainer would stop looking for content that exists.
      const get = async (url: string, key: string): Promise<Choice[] | null> => {
        const res = await fetch(url, { cache: "no-store" }).catch(() => null);
        if (!res?.ok) return null;
        const body = await res.json().catch(() => null);
        const rows = (body?.[key] ?? []) as { id: string; title: string }[];
        return rows.map((r) => ({ id: r.id, title: r.title }));
      };
      const [modules, decks, quizzes] = await Promise.all([
        get("/api/modules", "modules"),
        get("/api/decks", "decks"),
        get("/api/quizzes", "quizzes"),
      ]);
      if (!live) return;
      const failed = new Set<AssignmentKind>();
      if (modules === null) failed.add("module");
      if (decks === null) failed.add("deck");
      if (quizzes === null) failed.add("quiz");
      setFailedKinds(failed);
      setLists({
        module: modules ?? [],
        deck: decks ?? [],
        quiz: quizzes ?? [],
        doc: docs.map((d) => ({ id: d.id, title: d.name })),
      });
    })();
    return () => { live = false; };
  }, [docs]);

  const choices = lists?.[kind] ?? [];

  async function assign(choice: Choice) {
    setBusy(choice.id);
    const res = await assignContent({
      kind,
      refId: choice.id,
      assigneeId: member.id,
      assigneeName: member.name,
      title: choice.title,
      dueAt: due ? new Date(`${due}T23:59:59`).getTime() : null,
    });
    setBusy(null);
    notify(res.message);
    if (res.ok) { await reload(); onChanged(); }
  }

  async function remove(id: string, title: string) {
    setBusy(id);
    const res = await unassignAssignment(id, title);
    setBusy(null);
    notify(res.message);
    if (res.ok) { await reload(); onChanged(); }
  }

  return (
    <div className="dash-modal-backdrop" onClick={onClose}>
      <div
        className="dash-modal"
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={`Assign content to ${member.name}`}
        onClick={(e) => e.stopPropagation()}
      >
        <h2>Assign to {member.name}</h2>
        <p className="dash-muted" style={{ padding: 0, marginTop: 4 }}>
          Pick something to add to their queue. They complete it themselves — you&apos;ll see it in their progress.
        </p>
        <div className="upload-note" style={{ marginTop: 10 }}>
          Vitals only lists members who have opened it at least once from the HOSA member platform. If
          someone is missing, ask them to open Vitals once — until then they can&apos;t be assigned work.
        </div>

        <div className="seg-toggle" role="tablist" aria-label="Content type" style={{ marginTop: 12 }}>
          {KINDS.map((k) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={kind === k}
              className={`seg-btn${kind === k ? " is-active" : ""}`}
              onClick={() => setKind(k)}
            >
              {KIND_LABEL[k]} <span className="seg-count">{lists?.[k].length ?? 0}</span>
            </button>
          ))}
        </div>

        <label className="dash-field"><span>Due date (optional)</span>
          <input type="date" value={due} onChange={(e) => setDue(e.target.value)} /></label>

        <div className="assign-list">
          {!lists ? (
            <p className="dash-muted">Loading content...</p>
          ) : choices.length === 0 ? (
            <p className="dash-muted">
              {failedKinds.has(kind)
                ? `Couldn't load ${KIND_LABEL[kind].toLowerCase()} content. Close and reopen this to try again.`
                : `No ${KIND_LABEL[kind].toLowerCase()} content to assign yet.`}
            </p>
          ) : (
            choices.map((c) => (
              <button
                key={c.id}
                className="assign-row"
                disabled={busy === c.id}
                onClick={() => void assign(c)}
              >
                <span>{c.title}</span>
                <span className="assign-add">{busy === c.id ? "Assigning..." : "Assign"}</span>
              </button>
            ))
          )}
        </div>

        <p className="upload-settings-title" style={{ marginTop: 18 }}>
          Currently assigned{assignments.length > 0 ? ` (${assignments.length})` : ""}
        </p>
        <div className="assign-list">
          {loadingAssigned ? (
            <p className="dash-muted">Loading...</p>
          ) : assignedError ? (
            <p className="dash-muted">{assignedError}</p>
          ) : assignments.length === 0 ? (
            <p className="dash-muted">Nothing assigned yet.</p>
          ) : (
            assignments.map((a) => (
              <div key={a.id} className="assign-row" style={{ cursor: "default" }}>
                <span>
                  {a.title}
                  <span className="dash-muted" style={{ marginLeft: 8, fontSize: 12 }}>
                    {KIND_LABEL[a.kind]}
                    {a.status === "done" ? " · done" : formatDue(a.dueAt) ? ` · due ${formatDue(a.dueAt)}` : ""}
                  </span>
                </span>
                <button
                  type="button"
                  className="btn danger"
                  disabled={busy === a.id}
                  onClick={() => void remove(a.id, a.title)}
                >
                  {busy === a.id ? "Removing..." : "Unassign"}
                </button>
              </div>
            ))
          )}
        </div>

        <div className="dash-modal-actions"><button className="cta secondary" onClick={onClose}>Close</button></div>
      </div>
    </div>
  );
}
