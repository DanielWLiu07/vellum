"use client";

import Link from "next/link";
import * as React from "react";

import { parseCards } from "@/lib/parse-cards";

type Row = { front: string; back: string };

export function DeckEditor() {
  const [title, setTitle] = React.useState("");
  const [rows, setRows] = React.useState<Row[]>([{ front: "", back: "" }, { front: "", back: "" }]);
  const [paste, setPaste] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState<{ id: string; title: string; cardCount: number } | null>(null);

  const setRow = (i: number, key: keyof Row, val: string) =>
    setRows((r) => r.map((x, j) => (j === i ? { ...x, [key]: val } : x)));
  const addRow = () => setRows((r) => [...r, { front: "", back: "" }]);
  const removeRow = (i: number) => setRows((r) => (r.length > 1 ? r.filter((_, j) => j !== i) : r));

  function importPaste() {
    const cards = parseCards(paste);
    if (cards.length === 0) {
      setError("No cards found - one per line, term and definition split by a tab or comma.");
      return;
    }
    setError(null);
    setRows((r) => [...r.filter((x) => x.front.trim() || x.back.trim()), ...cards]);
    setPaste("");
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const cards = rows.filter((r) => r.front.trim() || r.back.trim());
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

  const count = rows.filter((r) => r.front.trim() || r.back.trim()).length;
  return (
    <form className="upload-card" onSubmit={save}>
      <h1 className="upload-h">Create flashcards</h1>
      <p className="dash-sub">
        Build a deck by hand, or paste from Quizlet / Anki / CSV. It joins the shared pool - please
        follow the <Link href="/guidelines" className="upload-inline-link">guidelines</Link>.
      </p>

      <label className="dash-field"><span>Deck title</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. ECG terms" maxLength={120} /></label>

      <div className="card-rows">
        {rows.map((r, i) => (
          <div key={i} className="card-row">
            <input className="card-input" value={r.front} onChange={(e) => setRow(i, "front", e.target.value)} placeholder={`Term ${i + 1}`} aria-label={`Card ${i + 1} term`} />
            <input className="card-input" value={r.back} onChange={(e) => setRow(i, "back", e.target.value)} placeholder="Definition" aria-label={`Card ${i + 1} definition`} />
            <button type="button" className="btn" onClick={() => removeRow(i)} aria-label={`Remove card ${i + 1}`}>Remove</button>
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
