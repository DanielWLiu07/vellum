"use client";

import Link from "next/link";
import * as React from "react";

import type { Deck } from "@/lib/decks";
import { RETURN_TO, returnLabel } from "@/lib/return-to";

// Self-grading study session (Anki-style). You flip a card, judge whether you
// knew it, and "Missed it" cards cycle back to the end of the queue until every
// card has been cleared once, then a completion summary. "Got it" retires the
// card for the session. This is what turns a flip-through into actual studying;
// the old linear browse is kept as a "Just browse" toggle.
export function DeckStudy({ deckId, backHref = RETURN_TO.flashcards }: {
  deckId: string;
  /** Validated destination for every way out of the session (lib/return-to). */
  backHref?: string;
}) {
  const backLabel = returnLabel(backHref);
  const [deck, setDeck] = React.useState<Deck | null>(null);
  const [err, setErr] = React.useState(false);

  // Session state. `queue` holds the card indices still to master; queue[0] is
  // the current card. `mastered` counts cleared cards, `attempts` counts every
  // grade given (so the summary can show how many extra passes the misses cost).
  const [queue, setQueue] = React.useState<number[]>([]);
  const [mastered, setMastered] = React.useState(0);
  const [attempts, setAttempts] = React.useState(0);
  const [flipped, setFlipped] = React.useState(false);
  const [done, setDone] = React.useState(false);
  const [browse, setBrowse] = React.useState(false);
  // Browse-mode position (linear flip-through, no grading).
  const [pos, setPos] = React.useState(0);

  const total = deck?.cards.length ?? 0;

  const start = React.useCallback(
    (cards: Deck["cards"], shuffle: boolean) => {
      const ids = cards.map((_, i) => i);
      if (shuffle) ids.sort(() => Math.random() - 0.5);
      setQueue(ids);
      setMastered(0);
      setAttempts(0);
      setFlipped(false);
      setDone(false);
      setPos(0);
    },
    [],
  );

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
      start(d.cards, false);
    })();
    return () => {
      cancelled = true;
    };
  }, [deckId, start]);

  // Grade the current card. gotIt retires it; a miss re-queues it to the back.
  const grade = React.useCallback(
    (gotIt: boolean) => {
      setAttempts((a) => a + 1);
      setFlipped(false);
      setQueue((q) => {
        if (q.length === 0) return q;
        const [head, ...rest] = q;
        if (gotIt) {
          setMastered((m) => m + 1);
          if (rest.length === 0) setDone(true);
          return rest;
        }
        return [...rest, head!];
      });
    },
    [],
  );

  const browseNext = React.useCallback(
    () => { setFlipped(false); setPos((p) => Math.min(total - 1, p + 1)); },
    [total],
  );
  const browsePrev = React.useCallback(
    () => { setFlipped(false); setPos((p) => Math.max(0, p - 1)); },
    [],
  );

  // Keyboard: Space/Enter flips. When flipped in study mode, Left/1 = missed,
  // Right/2 = got it. In browse mode, Left/Right move between cards.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (done) return;
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        setFlipped((f) => !f);
        return;
      }
      if (browse) {
        if (e.key === "ArrowRight") browseNext();
        else if (e.key === "ArrowLeft") browsePrev();
        return;
      }
      if (!flipped) return;
      if (e.key === "ArrowLeft" || e.key === "1") grade(false);
      else if (e.key === "ArrowRight" || e.key === "2") grade(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [browse, flipped, done, grade, browseNext, browsePrev]);

  if (err) {
    return <div className="upload-card"><p className="dash-sub">Deck not found.</p><Link className="btn" href={backHref}>← {backLabel}</Link></div>;
  }
  if (!deck) {
    return <div className="upload-card"><p className="dash-sub">Loading...</p></div>;
  }
  if (deck.cards.length === 0) {
    return (
      <div className="upload-card">
        <h1 className="upload-h">{deck.title}</h1>
        <p className="dash-sub">This deck has no cards yet.</p>
        <Link className="dash-back" href={backHref}>← {backLabel}</Link>
      </div>
    );
  }

  // ---- Completion summary --------------------------------------------------
  if (done) {
    const extra = attempts - total; // misses cost this many extra passes
    return (
      <div className="study">
        <div className="study-done">
          <span className="study-done-check" aria-hidden />
          <h1 className="upload-h">Deck cleared</h1>
          <p className="dash-sub">
            You got through all {total} card{total === 1 ? "" : "s"} in {deck.title}.
            {extra > 0 ? ` ${extra} needed a second look.` : " First pass, no misses."}
          </p>
          <div className="study-controls">
            <button type="button" className="btn" onClick={() => start(deck.cards, false)}>Study again</button>
            <button type="button" className="btn" onClick={() => start(deck.cards, true)}>Shuffle &amp; restart</button>
            {/* The default action once the deck is cleared: back to the list
                you started from, not another lap. */}
            <Link className="btn primary" href={backHref}>Done · {backLabel}</Link>
          </div>
        </div>
        <Link className="dash-back" href={backHref}>← {backLabel}</Link>
      </div>
    );
  }

  const idx = browse ? pos : (queue[0] ?? 0);
  const card = deck.cards[idx];
  if (!card) return null;

  const text = flipped ? card.back : card.front;
  const imageId = flipped ? card.backImageId : card.frontImageId;
  const progressPct = browse
    ? ((pos + 1) / total) * 100
    : (mastered / total) * 100;

  return (
    <div className="study">
      <div className="study-head">
        <h1 className="upload-h">{deck.title}</h1>
        <span className="section-count">
          {browse ? `${pos + 1} / ${total}` : `${mastered} / ${total} mastered`}
        </span>
      </div>
      <div className="study-progress" aria-hidden>
        <span style={{ width: `${progressPct}%` }} />
      </div>

      <button type="button" className="flashcard" onClick={() => setFlipped((f) => !f)} aria-label="Flip card">
        <span className="flashcard-side">{flipped ? "Definition" : "Term"}</span>
        {imageId ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="flashcard-img" src={`/api/images/${imageId}`} alt="" />
        ) : null}
        {text ? <span className="flashcard-text">{text}</span> : null}
        <span className="flashcard-hint">
          {flipped ? (browse ? "Space to flip back" : "Did you know it?") : "Space to flip"}
        </span>
      </button>

      {browse ? (
        <div className="study-controls">
          <button type="button" className="btn" onClick={browsePrev} disabled={pos === 0}>Previous</button>
          <button type="button" className="btn primary" onClick={browseNext} disabled={pos >= total - 1}>Next</button>
        </div>
      ) : flipped ? (
        <div className="study-controls">
          <button type="button" className="btn danger" onClick={() => grade(false)}>Missed it</button>
          <button type="button" className="btn primary" onClick={() => grade(true)}>Got it</button>
        </div>
      ) : (
        <div className="study-controls">
          <button type="button" className="btn primary" onClick={() => setFlipped(true)}>Reveal answer</button>
        </div>
      )}

      <div className="study-foot">
        <button
          type="button"
          className="study-mode-toggle"
          onClick={() => { setBrowse((b) => !b); setFlipped(false); setPos(0); }}
        >
          {browse ? "← Back to study mode" : "Just browse (no grading)"}
        </button>
        <Link className="dash-back" href={backHref}>← {backLabel}</Link>
      </div>
    </div>
  );
}
