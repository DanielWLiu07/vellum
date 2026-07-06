/**
 * Flashcard decks for Vitals's dashboard (content creation, not just upload).
 *
 * Demo-grade in-memory store (per serverless instance), mirroring lib/store.ts.
 * Decks are owned resources: they default to the shared pool (public), and the
 * owner can rescope them or grant per-person access via the share sidecar —
 * the same Google-Docs-style model documents use. A production build would
 * back this with a database; the API + UI wouldn't change.
 */

import { getShare } from "./resource-share";
import { type Card, parseCards } from "./parse-cards";
import type { PersonShare, Visibility } from "./visibility";

export type { Card };
export { parseCards };

export interface Deck {
  id: string;
  title: string;
  cards: Card[];
  createdAt: number;
  owner: string;
}

/** A deck with its share state composed in (what routes and the UI consume). */
export interface ScopedDeck extends Deck {
  visibility: Visibility;
  chapter: string;
  people: PersonShare[];
}

export interface DeckMeta {
  id: string;
  title: string;
  cardCount: number;
  createdAt: number;
  owner: string;
  visibility: Visibility;
  chapter: string;
  people: PersonShare[];
}

export const MAX_DECKS = 50;
export const MAX_CARDS = 500;
const TITLE_MAX = 120;
const FIELD_MAX = 2000;

const g = globalThis as unknown as { __vellumDecks?: Map<string, Deck> };
const store: Map<string, Deck> = (g.__vellumDecks ??= new Map());

// Seed the sample deck once. The `owner` check also HEALS a record seeded by
// an older module version without ownership — the globalThis map survives hot
// reloads and warm serverless instances across deploys.
if (!store.get("sample-deck")?.owner) {
  store.set("sample-deck", {
    id: "sample-deck",
    title: "HOSA - sample terms",
    cards: [
      { front: "Tachycardia", back: "A resting heart rate over 100 bpm." },
      { front: "Hypoxia", back: "Inadequate oxygen reaching the tissues." },
      { front: "Systole", back: "The contraction phase of the cardiac cycle." },
    ],
    createdAt: 0,
    owner: "system",
  });
}

const clamp = (s: string, n: number) => s.trim().slice(0, n);

/** Compose the share sidecar into a deck. Decks default to the shared pool. */
function withScope(d: Deck): ScopedDeck {
  const share = getShare(d.id);
  return {
    ...d,
    visibility: share?.visibility ?? "public",
    chapter: share?.chapter ?? "",
    people: share?.people ?? [],
  };
}

function cleanCards(cards: Card[]): Card[] {
  return cards
    .map((c) => ({
      front: clamp(c.front, FIELD_MAX),
      back: clamp(c.back, FIELD_MAX),
      ...(c.frontImageId ? { frontImageId: String(c.frontImageId).slice(0, 64) } : {}),
      ...(c.backImageId ? { backImageId: String(c.backImageId).slice(0, 64) } : {}),
    }))
    .filter((c) => c.front || c.back || c.frontImageId || c.backImageId)
    .slice(0, MAX_CARDS);
}

export function listDecks(): DeckMeta[] {
  return [...store.values()]
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((d) => {
      const s = withScope(d);
      return {
        id: s.id,
        title: s.title,
        cardCount: s.cards.length,
        createdAt: s.createdAt,
        owner: s.owner,
        visibility: s.visibility,
        chapter: s.chapter,
        people: s.people,
      };
    });
}

export function getDeck(id: string): ScopedDeck | undefined {
  const d = store.get(id);
  return d ? withScope(d) : undefined;
}

export function createDeck(title: string, cards: Card[], owner: string): Deck {
  const deck: Deck = {
    id: `d_${crypto.randomUUID()}`,
    title: clamp(title, TITLE_MAX) || "Untitled deck",
    cards: cleanCards(cards),
    createdAt: Date.now(),
    owner,
  };
  store.set(deck.id, deck);
  // Cap the store, evicting only the NEW owner's own oldest decks (never the
  // sample, never another owner's). A global eviction let anyone who can copy
  // a deck silently delete decks they don't own — see the storage-layer note.
  const mine = [...store.values()]
    .filter((d) => d.id !== "sample-deck" && d.owner === owner)
    .sort((a, b) => a.createdAt - b.createdAt);
  while (mine.length > MAX_DECKS) {
    const old = mine.shift();
    if (old) store.delete(old.id);
  }
  return deck;
}

/** Replace a deck's title and/or cards in place. The sample is immutable. */
export function updateDeck(id: string, patch: { title?: string; cards?: Card[] }): Deck | undefined {
  if (id === "sample-deck") return undefined;
  const deck = store.get(id);
  if (!deck) return undefined;
  if (patch.title !== undefined) deck.title = clamp(patch.title, TITLE_MAX) || "Untitled deck";
  if (patch.cards !== undefined) {
    const cards = cleanCards(patch.cards);
    if (cards.length === 0) return undefined; // don't let an update empty a deck
    deck.cards = cards;
  }
  return deck;
}

/**
 * Google-Docs "Make a copy": a full clone under the caller's ownership. The
 * caller decides the copy's scope (share sidecar) — copies start private.
 */
export function duplicateDeck(id: string, owner: string): Deck | undefined {
  const src = store.get(id);
  if (!src) return undefined;
  return createDeck(`Copy of ${src.title}`, src.cards.map((c) => ({ ...c })), owner);
}

export function deleteDeck(id: string): boolean {
  if (id === "sample-deck") return false; // sample is immutable
  return store.delete(id);
}
