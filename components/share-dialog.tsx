"use client";

// Google-Docs-style sharing dialog, shared by documents, decks, and quizzes.
// Two layers, saved together on Done:
//   - People with access: direct per-person grants, each viewer or editor
//   - General access: the visibility scope (private / chapter / public)
// The server enforces who may change sharing (owner or a granted editor);
// this dialog is just the controls.
//
// Both layers used to collect free text where the permission model compares
// ids, so both could confirm access that could never take effect:
//   - "Add people by name" wrote "Jane Smith" into people[].person, which
//     canView compares against the viewer's HOSA `sub` (a cuid). No name-to-id
//     resolution exists anywhere, so every grant it made was dead on arrival
//     while the dialog and the card both reported it as real. People are now
//     PICKED from /api/roster, the only source of ids, and the name is display
//     only.
//   - The chapter box was pre-filled with the chapter cuid and editable, so
//     tidying an ugly string into "Toronto Central" scoped the resource to
//     nobody. Chapter is not the sharer's to type: it comes from their signed
//     session, and is shown here read-only so they can see who they mean.

import * as React from "react";

import { initials } from "@/lib/avatar";
import {
  MAX_PEOPLE,
  SHARE_ROLES,
  VISIBILITIES,
  candidateMembers,
  resolveGrants,
  type DirectoryMember,
  type PersonShare,
  type ShareRole,
  type Visibility,
} from "@/lib/visibility";

import { useMe } from "./use-assignments";
import { useModal } from "./use-modal";
import { useNames } from "./use-names";

export interface ShareTarget {
  kind: "doc" | "deck" | "quiz";
  id: string;
  name: string;
  visibility: Visibility;
  chapter: string;
  people: PersonShare[];
  owner: string;
}

/** How many roster matches to list before asking for a narrower search. */
const MAX_SUGGESTIONS = 6;

// Local copy of the same map auth-panel keeps; it isn't exported from there,
// and member roles don't belong in lib/visibility, which is about the separate
// viewer/editor axis. Shown next to a name so two similar names are tellable
// apart before you grant one of them access.
const ROLE_LABEL: Record<string, string> = {
  student: "Student",
  trainer: "Trainer",
  advisor: "Advisor",
  admin: "Admin",
};

/** PATCH endpoint for a target's sharing, by resource kind. */
function endpoint(t: ShareTarget): string {
  if (t.kind === "deck") return `/api/decks/${t.id}`;
  if (t.kind === "quiz") return `/api/quizzes/${t.id}`;
  return `/api/doc/${t.id}`;
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
  const me = useMe();
  // Every member this viewer may share with, plus the id-to-name resolvers the
  // rest of the app uses. A student gets a reduced people-only roster for their
  // own chapter (200 + `limited`, NOT a 403), so this works for everyone who
  // can open the dialog.
  const {
    roster,
    directory,
    name: memberNameOf,
    chapter: chapterNameOf,
    loading: rosterLoading,
    error: rosterError,
    // Whether the directory is trustworthy enough to say a grant ISN'T in it.
    // While the roster is loading or failed, every id looks unresolvable, and
    // marking healthy grants as suspect during a blip is its own false claim.
    ready: directoryReady,
  } = useNames();
  const [people, setPeople] = React.useState<PersonShare[]>(target.people);
  const [visibility, setVisibility] = React.useState<Visibility>(target.visibility);
  const [query, setQuery] = React.useState("");
  const [role, setRole] = React.useState<ShareRole>("viewer");
  // Documents can be renamed here (their storage is immutable, so the name
  // lives in the share sidecar). Decks/quizzes rename via their own editors.
  const [docName, setDocName] = React.useState(target.name);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const ref = useModal(onClose);

  const isOwner = Boolean(me?.id) && me?.id === target.owner;
  // The chapter a save would actually scope to. For the owner that is their
  // session's chapter, which also repairs a resource whose stored chapter was
  // typed over by the old box. For an admin sharing someone ELSE's resource it
  // stays whatever is stored: re-homing another member's file into the admin's
  // chapter would be a second version of this same bug.
  const effectiveChapter = isOwner && me?.chapter ? me.chapter : target.chapter;
  const chapterName = chapterNameOf(effectiveChapter);

  const grants = React.useMemo(() => resolveGrants(people, directory), [people, directory]);
  const matches = React.useMemo(
    () => candidateMembers(directory, query, { exclude: people.map((p) => p.person), owner: target.owner }),
    [directory, query, people, target.owner],
  );
  const shown = matches.slice(0, MAX_SUGGESTIONS);

  function addPerson(m: DirectoryMember) {
    if (people.length >= MAX_PEOPLE) {
      setError(`Up to ${MAX_PEOPLE} people per resource.`);
      return;
    }
    setError(null);
    setPeople((prev) => [...prev.filter((p) => p.person !== m.id), { person: m.id, role }]);
    setQuery("");
  }

  async function save() {
    // Chapter scope with no chapter to scope to shows the resource to nobody -
    // the same silent dead end the editable box produced, so it's refused here
    // rather than confirmed and saved.
    if (visibility === "chapter" && !effectiveChapter) {
      setError("Your account has no chapter, so “Chapter only” would show this to nobody. Pick another option.");
      return;
    }
    setBusy(true);
    setError(null);
    const body: Record<string, unknown> = { visibility, people };
    // Only the owner's session can name the right chapter for their resource.
    if (isOwner && me?.chapter) body.chapter = me.chapter;
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
    if (!res?.ok) {
      setError("Couldn't save sharing. Try again.");
      return;
    }

    const saved = await res.json().catch(() => ({}));
    // The server can accept the request and still refuse the scope — a held
    // resource or a share-banned owner. Reporting "Sharing set to Chapter"
    // then leaving it private is how this looked like a bug that fixed itself
    // on refresh. Say what actually happened, and stay open so it's read.
    if (saved.clamped) {
      setError(
        saved.clampedReason === "held_for_review"
          ? "This resource is held for review, so it stays private until a reviewer clears it. Everything else was saved."
          : "Public sharing isn't available on your account, so this stays private. Everything else was saved.",
      );
      return;
    }
    if (saved.submittedForReview) {
      onSaved("Sent for review — it goes live once an admin approves it.");
      return;
    }

    const scope = VISIBILITIES.find((v) => v.id === visibility)?.label ?? visibility;
    onSaved(
      people.length > 0
        ? `Shared with ${people.length} ${people.length === 1 ? "person" : "people"} · ${scope}`
        : `Sharing set to ${scope}`,
    );
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

        <p className="share-section-label">Add people</p>
        {rosterError ? (
          // No free-text fallback. Accepting a typed name here is exactly the
          // bug: it would look like a grant and never be one.
          <p className="upload-error" role="alert">
            {rosterError} People can&apos;t be added until the member list loads.
          </p>
        ) : rosterLoading ? (
          <p className="share-empty">Loading members...</p>
        ) : (
          <>
            <div className="share-add-row">
              <input
                className="share-add-input"
                value={query}
                onChange={(e) => { setQuery(e.target.value); setError(null); }}
                placeholder="Search members by name"
                aria-label="Search members to add"
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
            </div>
            {shown.map((m) => (
              <div key={m.id} className="share-person-row">
                <span className="avatar">{initials(m.name || m.id)}</span>
                <span className="share-person-name">{m.name || m.id}</span>
                {m.role && <span className="share-person-role">{ROLE_LABEL[m.role] ?? m.role}</span>}
                <button type="button" className="btn" onClick={() => addPerson(m)}>
                  Add
                </button>
              </div>
            ))}
            {matches.length > shown.length && (
              <p className="share-empty">
                {matches.length - shown.length} more — keep typing to narrow the list.
              </p>
            )}
            {matches.length === 0 && (
              <p className="share-empty">
                {roster.length === 0
                  ? "Nobody from your chapter has opened Vitals yet, so there is no one to add."
                  : query.trim()
                    ? `No member matches “${query.trim()}”.`
                    : "Everyone available already has access."}
              </p>
            )}
          </>
        )}

        <div className="share-people">
          <p className="share-section-label">People with access</p>
          <div className="share-person-row">
            <span className="avatar">{initials(memberNameOf(target.owner))}</span>
            <span className="share-person-name">{memberNameOf(target.owner)}</span>
            <span className="share-person-role">Owner</span>
          </div>
          {grants.map((p) => (
            <div key={p.person} className="share-person-row">
              <span className="avatar">{initials(p.label)}</span>
              <span className="share-person-name" title={p.label}>{p.label}</span>
              {/* An unresolved id is either a dead grant from the old free-text
                  box or a real member outside this roster. We can't tell which,
                  so the wording doesn't claim to. */}
              {directoryReady && !p.known && (
                <span
                  className="share-person-role"
                  title="Not in the member list you can see. This may be someone from another chapter, or a grant left by the old sharing box that never worked."
                >
                  not in your list
                </span>
              )}
              <select
                className="sort-select"
                value={p.role}
                onChange={(e) =>
                  setPeople((prev) =>
                    prev.map((x) => (x.person === p.person ? { ...x, role: e.target.value as ShareRole } : x)),
                  )
                }
                aria-label={`Role for ${p.label}`}
              >
                {SHARE_ROLES.map((r) => (
                  <option key={r.id} value={r.id}>{r.label}</option>
                ))}
              </select>
              <button
                type="button"
                className="btn"
                onClick={() => setPeople((prev) => prev.filter((x) => x.person !== p.person))}
                aria-label={`Remove ${p.label}`}
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
            onChange={(e) => { setVisibility(e.target.value as Visibility); setError(null); }}
            aria-label="General access"
          >
            {VISIBILITIES.map((v) => (
              <option key={v.id} value={v.id}>{v.label}</option>
            ))}
          </select>
          <p className="share-general-hint">{VISIBILITIES.find((v) => v.id === visibility)?.hint}</p>
          {visibility === "chapter" && (
            // Read-only on purpose: chapter comes from the signed session, and
            // the editable version of this field silently broke chapter scope
            // for anyone who "fixed" the cuid it was pre-filled with.
            <p className="share-general-hint">
              {effectiveChapter
                ? <>Everyone in <strong>{chapterName}</strong> will be able to open it. This comes from {isOwner ? "your HOSA account" : "the owner's chapter"} and isn&apos;t set here.</>
                : "Your account has no chapter, so this option would show it to nobody."}
            </p>
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
