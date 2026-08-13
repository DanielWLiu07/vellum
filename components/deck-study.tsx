"use client";

import Link from "next/link";
import * as React from "react";

import type { Deck } from "@/lib/decks";
import { deckCardPart } from "@/lib/report-ux";
import { RETURN_TO, returnLabel } from "@/lib/return-to";
import { GRADE_BUTTONS, dueLabel, recordStudy } from "@/lib/study-client";
// Type-only: lib/study-activity owns the store and reaches node:fs, so a VALUE
// imported from it would follow the module into the client bundle. Types don't.
import type { DeckSchedule, StudyGrade } from "@/lib/study-activity";

import { ReportProblem } from "./report-problem";

/**
 * A spaced-repetition study session.
 *
 * This used to be a self-contained drill: shuffle the deck, grade yourself,
 * close the tab, forget everything. That is the one thing flashcards are not
 * supposed to be - the whole value is in being asked again at the moment you
 * are about to forget, and none of it survived the session.
 *
 * So the queue comes from the member's own schedule now (lib/study-activity,
 * via /api/study/progress) and every grade is recorded. The scheduling maths is
 * NOT repeated here: a second copy of "when does this card come back" is a
 * second answer waiting to disagree with the server's, so the component asks
 * for the schedule and re-reads it at the end rather than predicting it.
 *
 * "Just browse" stays, ungraded and unrecorded - flipping through a deck is
 * reading, not studying, and recording it would put reviews in a member's
 * transcript they never claimed.
 */
export function DeckStudy({ deckId, backHref = RETURN_TO.flashcards }: {
  deckId: string;
  /** Validated destination for every way out of the session (lib/return-to). */
  backHref?: string;
}) {
  const backLabel = returnLabel(backHref);
  const [deck, setDeck] = React.useState<Deck | null>(null);
  const [schedule, setSchedule] = React.useState<DeckSchedule | null>(null);
  const [err, setErr] = React.useState(false);

  // Session state. `queue` holds the card indices still to clear; queue[0] is
  // the current card. `attempts` counts every grade given, `cleared` only the
  // ones that retired a card, so the summary can show what the misses cost.
  const [queue, setQueue] = React.useState<number[]>([]);
  const [sessionSize, setSessionSize] = React.useState(0);
  const [attempts, setAttempts] = React.useState(0);
  const [cleared, setCleared] = React.useState(0);
  const [flipped, setFlipped] = React.useState(false);
  const [browse, setBrowse] = React.useState(false);
  // Browse-mode position (linear flip-through, no grading).
  const [pos, setPos] = React.useState(0);

  const total = deck?.cards.length ?? 0;

  const start = React.useCallback((indices: number[]) => {
    setQueue(indices);
    setSessionSize(indices.length);
    setAttempts(0);
    setCleared(0);
    setFlipped(false);
    setPos(0);
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      const [deckRes, schedRes] = await Promise.all([
        fetch(`/api/decks/${deckId}`, { cache: "no-store" }).catch(() => null),
        fetch(`/api/study/progress?kind=deck&refId=${encodeURIComponent(deckId)}`, { cache: "no-store" }).catch(() => null),
      ]);
      if (cancelled) return;
      if (!deckRes || !deckRes.ok) {
        setErr(true);
        return;
      }
      const d = (await deckRes.json()).deck as Deck;
      const s = schedRes?.ok
        ? ((await schedRes.json().catch(() => null))?.schedule as DeckSchedule | undefined)
        : undefined;
      if (cancelled) return;
      setDeck(d);
      setSchedule(s ?? null);
      // No schedule - signed out, or the read failed - means study the whole
      // deck in order. Reading content never waits on the progress store.
      start(s ? dueFirst(s) : d.cards.map((_, i) => i));
    })();
    return () => {
      cancelled = true;
    };
  }, [deckId, start]);

  const caughtUp = !browse && queue.length === 0 && attempts === 0 && total > 0;
  const finished = !browse && queue.length === 0 && attempts > 0;

  // Re-read the schedule once the session ends so the summary states when the
  // deck actually comes back, rather than this component guessing at it.
  React.useEffect(() => {
    if (!finished) return;
    let live = true;
    (async () => {
      const res = await fetch(`/api/study/progress?kind=deck&refId=${encodeURIComponent(deckId)}`, {
        cache: "no-store",
      }).catch(() => null);
      if (!live || !res?.ok) return;
      const s = (await res.json().catch(() => null))?.schedule as DeckSchedule | undefined;
      if (live && s) setSchedule(s);
    })();
    return () => {
      live = false;
    };
  }, [finished, deckId]);

  /**
   * Grade the current card.
   *
   * "Forgot" sends it to the back of this session as well as recording the
   * lapse - the point of pressing it is to see the card again now, and the
   * server's scheduler agrees (a forgotten card is due immediately). Anything
   * else retires it for the session; when it returns is the store's business.
   */
  const grade = React.useCallback(
    (value: StudyGrade) => {
      const head = queue[0];
      if (head === undefined) return;
      setFlipped(false);
      const key = schedule?.cards[head]?.key;
      // Fire and forget. A dropped grade costs one card's scheduling; blocking
      // the next card on a round-trip would make the drill stutter.
      if (key) {
        void recordStudy({ kind: "deck", refId: deckId, part: key, action: "reviewed", grade: value });
      }
      setAttempts((n) => n + 1);
      if (value === 0) {
        setQueue((q) => [...q.slice(1), head]);
      } else {
        setCleared((n) => n + 1);
        setQueue((q) => q.slice(1));
      }
    },
    [deckId, queue, schedule],
  );

  const browseNext = React.useCallback(
    () => { setFlipped(false); setPos((p) => Math.min(total - 1, p + 1)); },
    [total],
  );
  const browsePrev = React.useCallback(
    () => { setFlipped(false); setPos((p) => Math.max(0, p - 1)); },
    [],
  );

  // Keyboard: Space/Enter flips. When flipped in study mode, 1-4 are the four
  // grades and Left/Right stay bound to the two ends for muscle memory.
  // In browse mode, Left/Right move between cards.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (finished || caughtUp) return;
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
      if (e.key === "ArrowLeft") grade(0);
      else if (e.key === "ArrowRight") grade(2);
      else if (e.key >= "1" && e.key <= "4") grade((Number(e.key) - 1) as StudyGrade);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [browse, flipped, finished, caughtUp, grade, browseNext, browsePrev]);

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

  const all = () => start(deck.cards.map((_, i) => i));

  // ---- Nothing due -----------------------------------------------------------
  if (caughtUp) {
    // Never a dead end: spaced repetition says come back later, but a member
    // revising the night before an event is right and the deck is still theirs.
    return (
      <div className="study">
        <div className="study-done">
          <span className="study-done-check" aria-hidden />
          <h1 className="upload-h">Nothing due right now</h1>
          <p className="dash-sub">
            You&apos;re caught up on {deck.title}.
            {schedule?.nextDueAt
              ? ` The next ${schedule.resting === 1 ? "card comes" : "cards come"} back ${dueLabel(schedule.nextDueAt)}.`
              : ""}
          </p>
          <div className="study-controls">
            <button type="button" className="btn primary" onClick={all}>Study all {total} anyway</button>
            <Link className="btn" href={backHref}>Done · {backLabel}</Link>
          </div>
        </div>
        <Link className="dash-back" href={backHref}>← {backLabel}</Link>
      </div>
    );
  }

  // ---- Completion summary ----------------------------------------------------
  if (finished) {
    const extra = attempts - cleared; // misses cost this many extra passes
    return (
      <div className="study">
        <div className="study-done">
          <span className="study-done-check" aria-hidden />
          <h1 className="upload-h">Session complete</h1>
          <p className="dash-sub">
            You cleared {cleared} card{cleared === 1 ? "" : "s"} in {deck.title}.
            {extra > 0 ? ` ${extra} needed a second look.` : " First pass, no misses."}
            {schedule?.nextDueAt ? ` Next review ${dueLabel(schedule.nextDueAt)}.` : ""}
          </p>
          <div className="study-controls">
            <button type="button" className="btn" onClick={all}>Study all {total} again</button>
            {/* The default action once the queue is clear: back to the list you
                started from, not another lap. */}
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
    : sessionSize > 0 ? (cleared / sessionSize) * 100 : 0;

  return (
    <div className="study">
      <div className="study-head">
        <h1 className="upload-h">{deck.title}</h1>
        <span className="section-count">
          {browse ? `${pos + 1} / ${total}` : `${cleared} / ${sessionSize} cleared`}
        </span>
      </div>
      {/* What the schedule is actually holding back, so "3 cards" doesn't read
          as "this deck only has 3 cards". */}
      {!browse && schedule && (
        <p className="section-note">
          {schedule.due} due · {schedule.unseen} new · {schedule.resting} resting
          {schedule.nextDueAt ? ` · next back ${dueLabel(schedule.nextDueAt)}` : ""}
        </p>
      )}
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
          {flipped ? (browse ? "Space to flip back" : "How well did you know it?") : "Space to flip"}
        </span>
      </button>

      {browse ? (
        <div className="study-controls">
          <button type="button" className="btn" onClick={browsePrev} disabled={pos === 0}>Previous</button>
          <button type="button" className="btn primary" onClick={browseNext} disabled={pos >= total - 1}>Next</button>
        </div>
      ) : flipped ? (
        // Four grades, not two. "Got it" collapses "barely" and "instantly"
        // into one answer, and the gap between those is the entire input the
        // scheduler has to work with.
        <div className="study-controls">
          {GRADE_BUTTONS.map((b) => (
            <button key={b.grade} type="button" className={b.className} onClick={() => grade(b.grade)}>
              {b.label}
            </button>
          ))}
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
        {/* A wrong card is the same defect as a wrong answer key, and until now
            there was no way to say so. It reports the card ON SCREEN - the one
            the member is looking at when they decide the back is wrong - and it
            sends no target: FeedbackTarget has kinds for modules, docs and
            quizzes only, so a "deck" one would be dropped by normalizeTarget
            and file the report against nothing at all. The deck and the card go
            in the message instead (lib/report-ux). That costs an admin the
            per-content filter, which is a backend gap worth closing: a deck
            kind, and a card field to go with the question field quizzes have.

            Position and front text both go, because neither survives every
            edit on its own - see deckCardPart. */}
        <ReportProblem title={deck.title} part={deckCardPart(idx + 1, card.front)} />
        <Link className="dash-back" href={backHref}>← {backLabel}</Link>
      </div>
    </div>
  );
}

/**
 * The session queue: everything due, longest-overdue first, then cards never
 * seen. A card you were meant to review three days ago is more urgent than one
 * you have never met, and burying it under fifty new cards is how a backlog
 * becomes permanent.
 */
function dueFirst(schedule: DeckSchedule): number[] {
  return schedule.cards
    .filter((c) => c.due)
    .sort((a, b) => (a.state.dueAt ?? Infinity) - (b.state.dueAt ?? Infinity))
    .map((c) => c.index);
}
