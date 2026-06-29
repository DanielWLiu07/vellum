"use client";

import Link from "next/link";
import * as React from "react";

import type { Deck } from "@/lib/decks";

export function DeckStudy({ deckId }: { deckId: string }) {
  const [deck, setDeck] = React.useState<Deck | null>(null);
  const [err, setErr] = React.useState(false);
  const [order, setOrder] = React.useState<number[]>([]);
  const [pos, setPos] = React.useState(0);
  const [flipped, setFlipped] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch(`/api/decks/${deckId}`, { cache: "no-store" }).catch(() => null);
      if (cancelled) return;
      if (!res || !res.ok) {
        setErr(true);
        return;
      }
      const d = (await res.json()).deck as Deck;
      setDeck(d);
      setOrder(d.cards.map((_, i) => i));
    })();
    return () => {
      cancelled = true;
    };
  }, [deckId]);

  // Keyboard control: space/enter flips, arrows move. Bound once; uses
  // functional updates so it never goes stale.
  const len = order.length;
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        setFlipped((f) => !f);
      } else if (e.key === "ArrowRight") {
        setFlipped(false);
        setPos((p) => Math.min(len - 1, p + 1));
      } else if (e.key === "ArrowLeft") {
        setFlipped(false);
        setPos((p) => Math.max(0, p - 1));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [len]);

  if (err) {
    return <div className="upload-card"><p className="dash-sub">Deck not found.</p><Link className="btn" href="/dashboard">Back to dashboard</Link></div>;
  }
  if (!deck) {
    return <div className="upload-card"><p className="dash-sub">Loading...</p></div>;
  }
  if (deck.cards.length === 0) {
    return <div className="upload-card"><h1 className="upload-h">{deck.title}</h1><p className="dash-sub">This deck has no cards yet.</p></div>;
  }

  const idx = order[pos] ?? 0;
  const card = deck.cards[idx];
  if (!card) return null;

  const text = flipped ? card.back : card.front;
  const imageId = flipped ? card.backImageId : card.frontImageId;

  const next = () => { setFlipped(false); setPos((p) => Math.min(order.length - 1, p + 1)); };
  const prev = () => { setFlipped(false); setPos((p) => Math.max(0, p - 1)); };
  const shuffle = () => { setOrder((o) => [...o].sort(() => Math.random() - 0.5)); setPos(0); setFlipped(false); };

  return (
    <div className="study">
      <div className="study-head">
        <h1 className="upload-h">{deck.title}</h1>
        <span className="section-count">{pos + 1} / {order.length}</span>
      </div>
      <div className="study-progress" aria-hidden>
        <span style={{ width: `${((pos + 1) / order.length) * 100}%` }} />
      </div>

      <button type="button" className="flashcard" onClick={() => setFlipped((f) => !f)} aria-label="Flip card">
        <span className="flashcard-side">{flipped ? "Definition" : "Term"}</span>
        {imageId ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="flashcard-img" src={`/api/images/${imageId}`} alt="" />
        ) : null}
        {text ? <span className="flashcard-text">{text}</span> : null}
        <span className="flashcard-hint">Space to flip</span>
      </button>

      <div className="study-controls">
        <button type="button" className="btn" onClick={prev} disabled={pos === 0}>Previous</button>
        <button type="button" className="btn" onClick={shuffle}>Shuffle</button>
        <button type="button" className="btn primary" onClick={next} disabled={pos >= order.length - 1}>Next</button>
      </div>

      <Link className="dash-back" href="/dashboard">← Back to dashboard</Link>
    </div>
  );
}
