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

  const del = React.useCallback(async (id: string): Promise<void> => {
    setBusyId(id);
    setDecks((d) => d.filter((x) => x.id !== id));
    const res = await fetch(`/api/decks/${id}`, { method: "DELETE" }).catch(() => null);
    if (!res?.ok) await load();
    setBusyId(null);
  }, [load]);

  return { decks, load, copy, del, busyId };
}
