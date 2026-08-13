"use client";

import * as React from "react";

import type { DeckMeta } from "@/lib/decks";

/** Loads the viewer's visible decks and exposes copy/delete. Used by the
 * unified Resources view (decks are resources too). */
export function useDecks() {
  const [decks, setDecks] = React.useState<DeckMeta[]>([]);
  const [busyId, setBusyId] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    const res = await fetch("/api/decks", { cache: "no-store" }).catch(() => null);
    if (res?.ok) setDecks((await res.json()).decks);
  }, []);

  React.useEffect(() => {
    let live = true;
    fetch("/api/decks", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (live && j?.decks) setDecks(j.decks); })
      .catch(() => {});
    return () => { live = false; };
  }, []);

  const copy = React.useCallback(async (id: string): Promise<string | null> => {
    setBusyId(id);
    const res = await fetch(`/api/decks/${id}/copy`, { method: "POST" }).catch(() => null);
    setBusyId(null);
    if (res?.ok) {
      const j = await res.json();
      await load();
      return j.title as string;
    }
    return null;
  }, [load]);

  /**
   * Delete a deck. Returns null on success, or a message to show on failure.
   *
   * Deliberately NOT optimistic. Removing the tile first and reloading it back
   * on failure meant a refused delete rendered as a card that vanished and
   * returned on its own, with nothing said either way — the list looked buggy
   * rather than the delete looking refused. The deck now stays put until the
   * server confirms it is gone.
   *
   * NOTE: components/dashboard.tsx discards this return value, so a refused
   * delete is still unexplained there. The tile correctly survives now, which
   * is the important half; wiring the message up is a change to that file.
   */
  const del = React.useCallback(async (id: string): Promise<string | null> => {
    setBusyId(id);
    const res = await fetch(`/api/decks/${id}`, { method: "DELETE" }).catch(() => null);
    setBusyId(null);
    if (!res?.ok) return "Couldn't delete that deck. It's still here.";
    setDecks((d) => d.filter((x) => x.id !== id));
    return null;
  }, []);

  return { decks, load, copy, del, busyId };
}
