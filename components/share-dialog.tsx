"use client";

// Google-Docs-style sharing dialog, shared by documents, decks, and quizzes.
// Two layers, saved together on Done:
//   - People with access: direct per-person grants, each viewer or editor
//   - General access: the visibility scope (private / chapter / public)
// The server enforces who may change sharing (owner or a granted editor);
// this dialog is just the controls.

import * as React from "react";

import {
  MAX_PEOPLE,
  SHARE_ROLES,
  VISIBILITIES,
  type PersonShare,
  type ShareRole,
  type Visibility,
} from "@/lib/visibility";

import { useModal } from "./use-modal";

export interface ShareTarget {
  kind: "doc" | "deck" | "quiz";
  id: string;
  name: string;
  visibility: Visibility;
  chapter: string;
  people: PersonShare[];
  owner: string;
}

/** PATCH endpoint for a target's sharing, by resource kind. */
function endpoint(t: ShareTarget): string {
  if (t.kind === "deck") return `/api/decks/${t.id}`;
  if (t.kind === "quiz") return `/api/quizzes/${t.id}`;
  return `/api/doc/${t.id}`;
}

function initials(name: string): string {
  return name.split(" ").map((p) => p[0]).join("").slice(0, 2).toUpperCase();
}

export function ShareDialog({
  target,
  onClose,
  onSaved,
}: {
  target: ShareTarget;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [people, setPeople] = React.useState<PersonShare[]>(target.people);
  const [visibility, setVisibility] = React.useState<Visibility>(target.visibility);
  const [chapter, setChapter] = React.useState(target.chapter);
  const [name, setName] = React.useState("");
  const [role, setRole] = React.useState<ShareRole>("viewer");
  // Documents can be renamed here (their storage is immutable, so the name
  // lives in the share sidecar). Decks/quizzes rename via their own editors.
  const [docName, setDocName] = React.useState(target.name);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const ref = useModal(onClose);

  function addPerson() {
    const person = name.trim();
    if (!person) return;
    if (person === target.owner) {
      setError("That's the owner - they already have full access.");
      return;
    }
    if (people.length >= MAX_PEOPLE && !people.some((p) => p.person === person)) {
      setError(`Up to ${MAX_PEOPLE} people per resource.`);
      return;
    }
    setError(null);
    // Re-adding someone updates their role instead of duplicating them.
    setPeople((prev) => [...prev.filter((p) => p.person !== person), { person, role }]);
    setName("");
    setRole("viewer");
  }

  async function save() {
    setBusy(true);
    setError(null);
    const body: Record<string, unknown> = { visibility, chapter, people };
    // Send a rename only for docs, and only when it actually changed.
    if (target.kind === "doc" && docName.trim() && docName.trim() !== target.name) {
      body.name = docName.trim();
    }
    const res = await fetch(endpoint(target), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null);
    setBusy(false);
    if (res?.ok) {
      const scope = VISIBILITIES.find((v) => v.id === visibility)?.label ?? visibility;
      onSaved(
        people.length > 0
          ? `Shared with ${people.length} ${people.length === 1 ? "person" : "people"} · ${scope}`
          : `Sharing set to ${scope}`,
      );
    } else {
      setError("Couldn't save sharing. Try again.");
    }
  }

  return (
    <div className="dash-modal-backdrop" onClick={onClose}>
      <div
        className="dash-modal share-dialog"
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={`Share ${target.name}`}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="share-dialog-title" title={target.name}>Share &ldquo;{target.name}&rdquo;</h2>

        {target.kind === "doc" && (
          <label className="dash-field" style={{ marginTop: 12 }}>
            <span>Name</span>
            <input
              value={docName}
              onChange={(e) => setDocName(e.target.value)}
              placeholder="Document name"
              maxLength={120}
              aria-label="Document name"
            />
          </label>
        )}

        <div className="share-add-row">
          <input
            className="share-add-input"
            value={name}
            onChange={(e) => { setName(e.target.value); setError(null); }}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addPerson(); } }}
            placeholder="Add people by name"
            aria-label="Add a person"
            maxLength={60}
          />
          <select
            className="sort-select"
            value={role}
            onChange={(e) => setRole(e.target.value as ShareRole)}
            aria-label="Role for the person being added"
          >
            {SHARE_ROLES.map((r) => (
              <option key={r.id} value={r.id}>{r.label}</option>
            ))}
          </select>
          <button type="button" className="btn" onClick={addPerson} disabled={!name.trim()}>
            Add
          </button>
        </div>

        <div className="share-people">
          <p className="share-section-label">People with access</p>
          <div className="share-person-row">
            <span className="avatar">{initials(target.owner)}</span>
            <span className="share-person-name">{target.owner}</span>
            <span className="share-person-role">Owner</span>
          </div>
          {people.map((p) => (
            <div key={p.person} className="share-person-row">
              <span className="avatar">{initials(p.person)}</span>
              <span className="share-person-name">{p.person}</span>
              <select
                className="sort-select"
                value={p.role}
                onChange={(e) =>
                  setPeople((prev) =>
                    prev.map((x) => (x.person === p.person ? { ...x, role: e.target.value as ShareRole } : x)),
                  )
                }
                aria-label={`Role for ${p.person}`}
              >
                {SHARE_ROLES.map((r) => (
                  <option key={r.id} value={r.id}>{r.label}</option>
                ))}
              </select>
              <button
                type="button"
                className="btn"
                onClick={() => setPeople((prev) => prev.filter((x) => x.person !== p.person))}
                aria-label={`Remove ${p.person}`}
              >
                Remove
              </button>
            </div>
          ))}
          {people.length === 0 && (
            <p className="share-empty">Only the owner{visibility !== "private" ? " and the general-access scope below" : ""}.</p>
          )}
        </div>

        <div className="share-general">
          <p className="share-section-label">General access</p>
          <select
            className="sort-select share-general-select"
            value={visibility}
            onChange={(e) => setVisibility(e.target.value as Visibility)}
            aria-label="General access"
          >
            {VISIBILITIES.map((v) => (
              <option key={v.id} value={v.id}>{v.label}</option>
            ))}
          </select>
          <p className="share-general-hint">{VISIBILITIES.find((v) => v.id === visibility)?.hint}</p>
          {visibility === "chapter" && (
            <label className="dash-field" style={{ marginTop: 8 }}>
              <span>Chapter</span>
              <input
                value={chapter}
                onChange={(e) => setChapter(e.target.value)}
                placeholder="e.g. Toronto Central"
                maxLength={80}
              />
            </label>
          )}
        </div>

        {error && <p className="upload-error" role="alert">{error}</p>}
        <div className="dash-modal-actions">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="cta" disabled={busy} onClick={save}>{busy ? "Saving..." : "Done"}</button>
        </div>
      </div>
    </div>
  );
}
