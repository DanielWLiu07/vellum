/**
 * Flashcard decks for Vellum's dashboard (content creation, not just upload).
 *
 * Demo-grade in-memory store (per serverless instance), mirroring lib/store.ts.
 * Decks are part of the same shared pool everyone can see. A production build
 * would back this with a database; the API + UI wouldn't change.
 */

import { type Card, parseCards } from "./parse-cards";

export type { Card };
export { parseCards };

export interface Deck {
  id: string;
  title: string;
  cards: Card[];
  createdAt: number;
}
export interface DeckMeta {
  id: string;
  title: string;
  cardCount: number;
  createdAt: number;
}

export const MAX_DECKS = 50;
export const MAX_CARDS = 500;
const TITLE_MAX = 120;
const FIELD_MAX = 2000;

const g = globalThis as unknown as { __vellumDecks?: Map<string, Deck> };
const store: Map<string, Deck> = (g.__vellumDecks ??= new Map());

// Seed a sample deck once.
if (!store.has("sample-deck")) {
  store.set("sample-deck", {
    id: "sample-deck",
    title: "HOSA - sample terms",
    cards: [
      { front: "Tachycardia", back: "A resting heart rate over 100 bpm." },
      { front: "Hypoxia", back: "Inadequate oxygen reaching the tissues." },
      { front: "Systole", back: "The contraction phase of the cardiac cycle." },
    ],
    createdAt: 0,
  });
}

const clamp = (s: string, n: number) => s.trim().slice(0, n);

export function listDecks(): DeckMeta[] {
  return [...store.values()]
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((d) => ({ id: d.id, title: d.title, cardCount: d.cards.length, createdAt: d.createdAt }));
}

export function getDeck(id: string): Deck | undefined {
  return store.get(id);
}

export function createDeck(title: string, cards: Card[]): Deck {
  const clean = cards
    .map((c) => ({ front: clamp(c.front, FIELD_MAX), back: clamp(c.back, FIELD_MAX) }))
    .filter((c) => c.front || c.back)
    .slice(0, MAX_CARDS);
  const deck: Deck = {
    id: `d_${Math.random().toString(36).slice(2, 10)}`,
    title: clamp(title, TITLE_MAX) || "Untitled deck",
    cards: clean,
    createdAt: Date.now(),
  };
  store.set(deck.id, deck);
  // Evict the oldest user decks beyond the cap (keep the sample).
  const userDecks = [...store.values()].filter((d) => d.id !== "sample-deck").sort((a, b) => a.createdAt - b.createdAt);
  while (userDecks.length > MAX_DECKS) {
    const old = userDecks.shift();
    if (old) store.delete(old.id);
  }
  return deck;
}

export function deleteDeck(id: string): boolean {
  if (id === "sample-deck") return false; // sample is immutable
  return store.delete(id);
}
