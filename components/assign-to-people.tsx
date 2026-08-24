"use client";

import { useEffect, useMemo, useState } from "react";

import { initials } from "@/lib/avatar";

import {
  assignContent,
  KIND_LABEL,
  useAssignments,
  useMe,
  useRoster,
  type AssignmentKind,
  type RosterMember,
} from "./use-assignments";
import { useModal } from "./use-modal";

/**
 * Assign ONE resource to MANY members — the resource-first half of the loop.
 *
 * The person-first modal (assign-modal.tsx) answers "what should this member
 * work on?", which is the right question at the start of a term and the wrong
 * one every other time. The common act is the opposite: a trainer publishes a
 * module and wants their group on it. Person-first made that N trips through
 * the same dialog, once per member, with the resource re-picked every time —
 * and no screen anywhere answered "who has this?".
 *
 * So this one opens FROM the resource, already knowing what is being handed
 * out, and asks only who. Both directions write the same assignment record
 * through the same endpoint; neither is a special case of the other.
 */
export function AssignToPeople({ resource, onClose, onChanged, notify }: {
  resource: { kind: AssignmentKind; id: string; title: string };
  onClose: () => void;
  onChanged?: () => void;
  notify: (msg: string) => void;
}) {
  const ref = useModal(onClose);
  const me = useMe();
  // No argument: useRoster's parameter FILTERS the roster by member role, it
  // does not describe the caller. Passing me.role here returned only the
  // other trainers, and then self-exclusion emptied the list entirely.
  const { roster, loading: loadingRoster, error: rosterError } = useRoster();
  // No assignee filter: for a trainer this is the whole chapter, which is what
  // lets us answer "who already has this?" without a request per member.
  const { assignments, loading: loadingAssigned, error: assignedError, reload } = useAssignments();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [due, setDue] = useState("");
  const [busy, setBusy] = useState(false);
  // Sections of the module being assigned. null while the read is in flight,
  // [] if it failed or there are none - the control hides in both cases rather
  // than offering a choice it cannot honour.
  const [fetched, setFetched] = useState<{ id: string; title: string }[] | null>(null);
  const [wholeThing, setWholeThing] = useState(true);
  const [parts, setParts] = useState<Set<string>>(new Set());

  // Derived, not stored: only modules have sections, and writing [] into state
  // for every other kind would be a synchronous setState inside an effect.
  const sections = resource.kind === "module" ? fetched : [];

  useEffect(() => {
    if (resource.kind !== "module") return;
    let live = true;
    void (async () => {
      const res = await fetch(`/api/modules/${encodeURIComponent(resource.id)}`, { cache: "no-store" }).catch(() => null);
      const j = res?.ok ? await res.json().catch(() => null) : null;
      if (!live) return;
      const raw = (j?.module?.sections ?? []) as { id?: string; title?: string }[];
      setFetched(raw.filter((x) => x.id).map((x, i) => ({ id: String(x.id), title: x.title || `Section ${i + 1}` })));
    })();
    return () => { live = false; };
  }, [resource.kind, resource.id]);

  // Who already holds THIS resource. Keyed on kind+refId because ids are only
  // unique within their own store — a deck and a quiz may share one.
  const holders = useMemo(() => {
    const out = new Map<string, { done: boolean }>();
    for (const a of assignments) {
      if (a.kind === resource.kind && a.refId === resource.id) out.set(a.assigneeId, { done: a.status === "done" });
    }
    return out;
  }, [assignments, resource.kind, resource.id]);

  // You are on your own roster; assigning work to yourself is not the feature.
  const candidates = useMemo(() => roster.filter((m) => m.id !== me?.id), [roster, me?.id]);
  const assignable = useMemo(() => candidates.filter((m) => !holders.has(m.id)), [candidates, holders]);
  const allPicked = assignable.length > 0 && assignable.every((m) => picked.has(m.id));

  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  async function submit() {
    const targets = assignable.filter((m) => picked.has(m.id));
    if (targets.length === 0) return;
    setBusy(true);
    const dueAt = due ? new Date(`${due}T23:59:59`).getTime() : null;
    // Undefined, not an empty array: the API reads "no parts" as the whole
    // resource, and an explicit empty list would be a request for nothing.
    const chosenParts = wholeThing || parts.size === 0 ? undefined : [...parts];
    // Sequential: the store is last-write-wins and the cap is per assignee, so
    // firing N writes at once buys nothing and makes a partial failure harder
    // to attribute.
    const failures: string[] = [];
    for (const m of targets) {
      const res = await assignContent({
        kind: resource.kind,
        refId: resource.id,
        assigneeId: m.id,
        assigneeName: m.name,
        title: resource.title,
        dueAt,
        parts: chosenParts,
      });
      if (!res.ok) failures.push(`${m.name}: ${res.message}`);
    }
    setBusy(false);
    setPicked(new Set());
    await reload();
    onChanged?.();

    // Report what actually happened. "Assigned to 5 members" after two refusals
    // is the kind of confident lie this codebase has had to fix before.
    const done = targets.length - failures.length;
    if (failures.length === 0) {
      notify(`Assigned "${resource.title}" to ${done} ${done === 1 ? "member" : "members"}`);
    } else if (done === 0) {
      notify(`Couldn't assign to anyone. ${failures[0]}`);
    } else {
      notify(`Assigned to ${done} of ${targets.length}. Failed — ${failures.join("; ")}`);
    }
  }

  // "Just part of it" with nothing ticked would assign the WHOLE module, which
  // is the opposite of what was asked for. Block the button instead.
  const noPartsChosen = !wholeThing && parts.size === 0;

  const listState =
    loadingRoster ? "Loading members..." :
    rosterError ? rosterError :
    candidates.length === 0 ? "No other members in your chapter have opened Vitals yet." :
    null;

  return (
    <div className="dash-modal-backdrop" onClick={onClose}>
      <div
        className="dash-modal"
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={`Assign ${resource.title} to members`}
        onClick={(e) => e.stopPropagation()}
      >
        <h2>Assign this {KIND_LABEL[resource.kind].toLowerCase()}</h2>
        <p className="dash-muted" style={{ padding: 0, marginTop: 4 }}>
          <strong>{resource.title}</strong>{" "}— pick who should work through it. They complete it
          themselves; you&apos;ll see it in their progress.
        </p>
        <div className="upload-note" style={{ marginTop: 10 }}>
          Vitals only lists members who have opened it at least once from the HOSA member platform. If
          someone is missing, ask them to open Vitals once — until then they can&apos;t be assigned work.
        </div>

        {sections !== null && sections.length > 1 && (
          <fieldset className="assign-scope">
            <legend className="upload-settings-title">What to assign</legend>
            <label className="assign-scope-opt">
              <input
                type="radio"
                name="assign-scope"
                checked={wholeThing}
                onChange={() => setWholeThing(true)}
                disabled={busy}
              />
              <span>The whole {KIND_LABEL[resource.kind].toLowerCase()} <span className="dash-muted">({sections.length} sections)</span></span>
            </label>
            <label className="assign-scope-opt">
              <input
                type="radio"
                name="assign-scope"
                checked={!wholeThing}
                onChange={() => setWholeThing(false)}
                disabled={busy}
              />
              <span>Just part of it</span>
            </label>
            {!wholeThing && (
              <div className="assign-parts">
                {sections.map((sec, i) => (
                  <label key={sec.id} className="assign-part">
                    <input
                      type="checkbox"
                      checked={parts.has(sec.id)}
                      disabled={busy}
                      onChange={() =>
                        setParts((prev) => {
                          const next = new Set(prev);
                          if (next.has(sec.id)) next.delete(sec.id); else next.add(sec.id);
                          return next;
                        })
                      }
                    />
                    <span>{i + 1}. {sec.title}</span>
                  </label>
                ))}
              </div>
            )}
          </fieldset>
        )}

        <label className="dash-field"><span>Due date (optional)</span>
          <input type="date" value={due} onChange={(e) => setDue(e.target.value)} /></label>

        <div className="assign-people-head">
          <p className="upload-settings-title" style={{ margin: 0 }}>
            Members{candidates.length > 0 ? ` (${candidates.length})` : ""}
          </p>
          {assignable.length > 0 && (
            <button
              type="button"
              className="btn"
              onClick={() => setPicked(allPicked ? new Set() : new Set(assignable.map((m) => m.id)))}
            >
              {allPicked ? "Clear all" : `Select all ${assignable.length}`}
            </button>
          )}
        </div>

        <div className="assign-list">
          {listState ? (
            <p className="dash-muted">{listState}</p>
          ) : (
            candidates.map((m: RosterMember) => {
              const held = holders.get(m.id);
              return (
                <label key={m.id} className={`assign-person${held ? " is-held" : ""}`}>
                  <input
                    type="checkbox"
                    checked={held ? true : picked.has(m.id)}
                    disabled={Boolean(held) || busy}
                    onChange={() => toggle(m.id)}
                  />
                  <span className="avatar" aria-hidden>{initials(m.name)}</span>
                  <span className="assign-row-text">
                    <span className="assign-row-title">{m.name}</span>
                    <span className="dash-muted assign-row-meta">
                      {m.role}
                      {held ? (held.done ? " · already assigned, done" : " · already assigned") : ""}
                    </span>
                  </span>
                </label>
              );
            })
          )}
          {/* A failed read of the chapter's assignments means "already assigned"
              is unknown, not false — say so rather than offering to assign work
              a member may already have. */}
          {assignedError && !loadingAssigned && (
            <p className="dash-muted">Couldn&apos;t check who already has this ({assignedError}).</p>
          )}
        </div>

        <div className="dash-modal-actions">
          <button className="cta secondary" onClick={onClose} disabled={busy}>Close</button>
          <button
            className="cta"
            onClick={() => void submit()}
            disabled={busy || picked.size === 0 || noPartsChosen}
          >
            {busy
              ? "Assigning..."
              : noPartsChosen
                ? "Pick at least one part"
                : picked.size === 0
                  ? "Assign"
                  : `Assign to ${picked.size}`}
          </button>
        </div>
      </div>
    </div>
  );
}
