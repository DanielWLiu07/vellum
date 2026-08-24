"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";

import { autosaveInit } from "@/lib/autosave-request";
import { parseCards } from "@/lib/parse-cards";
import { RETURN_TO, returnLabel, withBack } from "@/lib/return-to";
import type { Visibility } from "@/lib/visibility";

import { ImageField } from "./image-field";
import { useAutosave, type SaveStatus } from "./use-autosave";

const VISIBILITY_OPTIONS: { id: Visibility; label: string }[] = [
  { id: "private", label: "Private - just me (draft)" },
  { id: "chapter", label: "My chapter" },
  { id: "public", label: "Everyone (shared pool)" },
];

type Row = { front: string; back: string; frontImageId?: string; backImageId?: string };

const blank = (): Row => ({ front: "", back: "" });
const hasContent = (r: Row) => Boolean(r.front.trim() || r.back.trim() || r.frontImageId || r.backImageId);

/**
 * Create a deck, or — with `editId` — edit an existing one in place
 * (Google-Docs-style direct editing; the server allows it for the owner or a
 * granted editor).
 */
export function DeckEditor({ editId, backHref = RETURN_TO.flashcards, selfHref }: {
  editId?: string;
  /** Validated destination for "Done" and for the deck this editor creates. */
  backHref?: string;
  /** This editor's own URL, handed to the study link so it comes back here. */
  selfHref?: string;
} = {}) {
  const backLabel = returnLabel(backHref);
  const router = useRouter();
  const [title, setTitle] = React.useState("");
  const [rows, setRows] = React.useState<Row[]>([blank(), blank()]);
  const [paste, setPaste] = React.useState("");
  const [visibility, setVisibility] = React.useState<Visibility>("private");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  // idle -> ready (create mode is instantly ready); loading/denied for edit mode.
  const [editState, setEditState] = React.useState<"ready" | "loading" | "denied">(editId ? "loading" : "ready");

  // Edit mode is live (Google-Docs style): changes autosave, no save button.
  // We save the FULL on-screen state (title + savable cards, possibly empty) so
  // title-only edits and card deletions both persist faithfully.
  const saveAbort = React.useRef<AbortController | null>(null);
  async function autosaveNow(): Promise<boolean> {
    const cards = rows.filter(hasContent);
    saveAbort.current?.abort(); // cancel a still-in-flight older save (no out-of-order)
    const ctrl = new AbortController();
    saveAbort.current = ctrl;
    try {
      const res = await fetch(
        `/api/decks/${editId}`,
        autosaveInit(JSON.stringify({ title, cards }), ctrl.signal),
      );
      if (res.ok) { setError(null); return true; }
      const j = await res.json().catch(() => null);
      setError(
        j?.error === "content_flagged"
          ? `Content moderation flagged this deck${Array.isArray(j.categories) && j.categories.length ? ` (${j.categories.join(", ")})` : ""}. Fix it to keep saving.`
          : "Couldn't save your changes.",
      );
      return false;
    } catch (e) {
      if ((e as Error)?.name === "AbortError") return true; // superseded by a newer save
      setError("Couldn't save your changes.");
      return false;
    }
  }
  // Key off the SAVABLE payload so structural no-ops (adding/removing a blank
  // row) don't fire a save + moderation round-trip.
  const status = useAutosave(autosaveNow, JSON.stringify({ title, cards: rows.filter(hasContent) }), {
    enabled: Boolean(editId) && editState === "ready",
  });

  // Edit mode: load the existing deck into the form.
  React.useEffect(() => {
    if (!editId) return;
    let cancelled = false;
    (async () => {
      const res = await fetch(`/api/decks/${editId}`, { cache: "no-store" }).catch(() => null);
      const j = res?.ok ? await res.json().catch(() => null) : null;
      if (cancelled) return;
      if (!j?.deck || !j?.canEdit) {
        setEditState("denied");
        return;
      }
      setTitle(j.deck.title);
      const loaded = (j.deck.cards as Row[]).map((c) => ({
        front: c.front ?? "",
        back: c.back ?? "",
        ...(c.frontImageId ? { frontImageId: c.frontImageId } : {}),
        ...(c.backImageId ? { backImageId: c.backImageId } : {}),
      }));
      // A fresh draft has no cards yet - show two blank rows to type into.
      setRows(loaded.length ? loaded : [blank(), blank()]);
      setEditState("ready");
    })();
    return () => {
      cancelled = true;
    };
  }, [editId]);

  const setRow = (i: number, key: keyof Row, val: string | undefined) =>
    setRows((r) => r.map((x, j) => (j === i ? { ...x, [key]: val } : x)));
  const addRow = () => setRows((r) => [...r, blank()]);
  const removeRow = (i: number) => setRows((r) => (r.length > 1 ? r.filter((_, j) => j !== i) : r));

  function importPaste() {
    const cards = parseCards(paste);
    if (cards.length === 0) {
      setError("No cards found - one per line, term and definition split by a tab or comma.");
      return;
    }
    setError(null);
    setRows((r) => [...r.filter(hasContent), ...cards]);
    setPaste("");
  }

  // Create: make an (empty) deck with its settings, then drop the user INTO
  // its live editor to add cards.
  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      setError("Give your deck a name.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/decks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, cards: [], visibility }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        setError(
          j?.error === "content_flagged"
            ? `Content moderation flagged this deck${Array.isArray(j.categories) && j.categories.length ? ` (${j.categories.join(", ")})` : ""}. Please revise it.`
            : "Couldn't create the deck.",
        );
        return;
      }
      const doc = await res.json();
      // Into the new deck's editor, still carrying the list this flow started
      // from — "Done" in there returns to it rather than to a blank form.
      router.push(withBack(`/decks/${doc.id}/edit`, backHref));
    } finally {
      setBusy(false);
    }
  }

  if (editState === "loading") {
    return <div className="upload-card"><p className="dash-sub">Loading the deck...</p></div>;
  }
  if (editState === "denied") {
    return (
      <div className="upload-card">
        <h1 className="upload-h">Can&apos;t edit this deck</h1>
        <p className="dash-sub">It doesn&apos;t exist, or you don&apos;t have editor access. Ask the owner to add you as an editor, or make a copy instead.</p>
        <div className="upload-actions"><Link className="btn" href={backHref}>← {backLabel}</Link></div>
      </div>
    );
  }

  // CREATE: name it + choose visibility, then go inside to add cards.
  if (!editId) {
    return (
      <form className="upload-card" onSubmit={create}>
        <h1 className="upload-h">New flashcard deck</h1>
        <p className="dash-sub">Name it and choose who can see it. You&apos;ll add cards next.</p>
        <label className="dash-field"><span>Deck title</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. ECG terms" maxLength={120} autoFocus /></label>
        <label className="dash-field"><span>Who can see it</span>
          <select value={visibility} onChange={(e) => setVisibility(e.target.value as Visibility)}>
            {VISIBILITY_OPTIONS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select></label>
        {error && <p className="upload-error" role="alert">{error}</p>}
        <div>
          <button type="submit" className="cta" disabled={busy || !title.trim()}>
            {busy ? "Creating..." : "Create & add cards"}
          </button>
        </div>
      </form>
    );
  }

  const count = rows.filter(hasContent).length;
  return (
    <form className="upload-card" onSubmit={(e) => e.preventDefault()}>
      <div className="editor-head">
        <h1 className="upload-h">{`Edit deck${title ? `: ${title}` : ""}`}</h1>
        <SaveStatusChip status={status} />
      </div>
      <p className="dash-sub">
        Add cards by hand with an image on any face, or paste from Quizlet / Anki / CSV. Changes
        save automatically.
      </p>

      <label className="dash-field"><span>Deck title</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. ECG terms" maxLength={120} /></label>

      <div className="card-edit-list">
        {rows.map((r, i) => (
          <div key={i} className="card-edit">
            <div className="card-edit-head">
              <span className="card-edit-num">Card {i + 1}</span>
              <button type="button" className="card-edit-remove" onClick={() => removeRow(i)} aria-label={`Remove card ${i + 1}`}>
                Remove
              </button>
            </div>
            <div className="card-edit-sides">
              <div className="card-edit-side">
                <input className="card-input" value={r.front} onChange={(e) => setRow(i, "front", e.target.value)} placeholder="Term" aria-label={`Card ${i + 1} term`} />
                <ImageField id={r.frontImageId} onChange={(id) => setRow(i, "frontImageId", id)} label="term" />
              </div>
              <div className="card-edit-side">
                <input className="card-input" value={r.back} onChange={(e) => setRow(i, "back", e.target.value)} placeholder="Definition" aria-label={`Card ${i + 1} definition`} />
                <ImageField id={r.backImageId} onChange={(id) => setRow(i, "backImageId", id)} label="definition" />
              </div>
            </div>
          </div>
        ))}
        <div><button type="button" className="btn" onClick={addRow}>+ Add card</button></div>
      </div>

      <div className="upload-settings">
        <p className="upload-settings-title">Import from another source</p>
        <textarea
          className="paste-area"
          value={paste}
          onChange={(e) => setPaste(e.target.value)}
          rows={4}
          aria-label="Paste cards to import"
          placeholder={"Paste one card per line - term and definition separated by a tab or comma.\nExample:\nTachycardia\tFast heart rate"}
        />
        <div><button type="button" className="btn" onClick={importPaste}>Add from paste</button></div>
      </div>

      {error && <p className="upload-error" role="alert">{error}</p>}
      <div className="upload-actions">
        <Link className="cta" href={withBack(`/decks/${editId}`, selfHref ?? backHref)}>Study it</Link>
        <Link className="btn" href={backHref}>Done · {backLabel}</Link>
        <SaveStatusChip status={status} />
        <span className="dash-sub" style={{ marginLeft: "auto", fontSize: 13 }}>{count} card{count === 1 ? "" : "s"}</span>
      </div>
    </form>
  );
}

/** Live autosave status shown in the editor (edit mode). */
function SaveStatusChip({ status }: { status: SaveStatus }) {
  return (
    <span className={`save-status save-status-${status}`} aria-live="polite">
      {status === "saving" ? "Saving..." : status === "error" ? "Save failed" : "All changes saved"}
    </span>
  );
}
