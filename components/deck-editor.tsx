"use client";

import Link from "next/link";
import * as React from "react";

import { parseCards } from "@/lib/parse-cards";

type Row = { front: string; back: string; frontImageId?: string; backImageId?: string };

const blank = (): Row => ({ front: "", back: "" });
const hasContent = (r: Row) => Boolean(r.front.trim() || r.back.trim() || r.frontImageId || r.backImageId);

/** Upload a card-side image to /api/images and hand back its id. */
function ImageField({
  id,
  onChange,
  label,
}: {
  id?: string;
  onChange: (id: string | undefined) => void;
  label: string;
}) {
  const ref = React.useRef<HTMLInputElement>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState(false);

  async function pick(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError(false);
    try {
      const fd = new FormData();
      fd.set("file", file);
      const res = await fetch("/api/images", { method: "POST", body: fd });
      if (res.ok) onChange((await res.json()).id);
      else setError(true);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  if (id) {
    return (
      <div className="card-img">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`/api/images/${id}`} alt={`${label} image`} />
        <button type="button" className="card-img-remove" onClick={() => onChange(undefined)}>
          Remove image
        </button>
      </div>
    );
  }
  return (
    <>
      <button type="button" className="card-img-add" onClick={() => ref.current?.click()} disabled={busy}>
        {busy ? "Uploading..." : error ? "Try again" : "+ Image"}
      </button>
      <input
        ref={ref}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        hidden
        onChange={(e) => pick(e.target.files?.[0])}
      />
    </>
  );
}

export function DeckEditor() {
  const [title, setTitle] = React.useState("");
  const [rows, setRows] = React.useState<Row[]>([blank(), blank()]);
  const [paste, setPaste] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState<{ id: string; title: string; cardCount: number } | null>(null);

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

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const cards = rows.filter(hasContent);
    if (cards.length === 0) {
      setError("Add at least one card.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/decks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, cards }),
      });
      if (!res.ok) {
        setError("Couldn't save the deck.");
        return;
      }
      setSaved(await res.json());
    } finally {
      setBusy(false);
    }
  }

  if (saved) {
    return (
      <div className="upload-card">
        <span className="pill">Created</span>
        <h1 className="upload-h">{saved.title} - {saved.cardCount} cards</h1>
        <p className="dash-sub">Your deck is in the shared pool, ready for every member to study.</p>
        <div className="upload-actions">
          <Link className="cta" href={`/decks/${saved.id}`}>Study it</Link>
          <Link className="btn" href="/dashboard">Back to dashboard</Link>
        </div>
      </div>
    );
  }

  const count = rows.filter(hasContent).length;
  return (
    <form className="upload-card" onSubmit={save}>
      <h1 className="upload-h">Create flashcards</h1>
      <p className="dash-sub">
        Build a deck by hand and add an image to any card, or paste from Quizlet / Anki / CSV. It
        joins the shared pool - please follow the{" "}
        <Link href="/guidelines" className="upload-inline-link">guidelines</Link>.
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
      <div>
        <button type="submit" className="cta" disabled={busy || count === 0}>
          {busy ? "Saving..." : `Create deck (${count} card${count === 1 ? "" : "s"})`}
        </button>
      </div>
    </form>
  );
}
