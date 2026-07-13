"use client";

import * as React from "react";

interface FavoritesCtx {
  favorites: Set<string>;
  isFavorite: (id: string) => boolean;
  /** Global like-count for a resource (across all members). */
  countOf: (id: string) => number;
  toggle: (id: string) => void;
  ready: boolean;
}

const Ctx = React.createContext<FavoritesCtx | null>(null);

/**
 * Loads the viewer's saved-resource ids and the global like-counts once, then
 * shares them across every resource card so the hearts, the counts, and the
 * "Saved" filter all agree. Toggles are optimistic - the heart flips and the
 * count adjusts instantly, rolling back only if the request fails.
 */
export function FavoritesProvider({ children }: { children: React.ReactNode }) {
  const [favorites, setFavorites] = React.useState<Set<string>>(new Set());
  const [counts, setCounts] = React.useState<Record<string, number>>({});
  const [ready, setReady] = React.useState(false);
  // Per-id request token: only the newest toggle for an id may reconcile or roll
  // back, so a slow/failed earlier request can't clobber a later one.
  const seq = React.useRef<Map<string, number>>(new Map());

  React.useEffect(() => {
    let live = true;
    fetch("/api/favorites")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!live || !j) return;
        if (Array.isArray(j.ids)) setFavorites(new Set(j.ids));
        if (j.counts && typeof j.counts === "object") setCounts(j.counts);
      })
      .catch(() => {})
      .finally(() => { if (live) setReady(true); });
    return () => { live = false; };
  }, []);

  const toggle = React.useCallback((id: string) => {
    const next = !favorites.has(id);
    const token = (seq.current.get(id) ?? 0) + 1;
    seq.current.set(id, token);
    const isLatest = () => seq.current.get(id) === token;

    // Optimistic: flip the heart and nudge the count by one.
    setFavorites((prev) => {
      const s = new Set(prev);
      if (next) s.add(id); else s.delete(id);
      return s;
    });
    setCounts((prev) => ({ ...prev, [id]: Math.max(0, (prev[id] ?? 0) + (next ? 1 : -1)) }));

    fetch("/api/favorites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, favorite: next }),
    })
      .then(async (r) => {
        if (!r.ok) throw new Error("failed");
        const data = await r.json().catch(() => null);
        // Reconcile to the server's authoritative state, but only if no newer
        // toggle for this id has superseded us (heals any optimistic drift).
        if (data && isLatest()) {
          if (typeof data.count === "number") setCounts((prev) => ({ ...prev, [id]: data.count }));
          if (typeof data.favorite === "boolean") {
            setFavorites((prev) => {
              const s = new Set(prev);
              if (data.favorite) s.add(id); else s.delete(id);
              return s;
            });
          }
        }
      })
      .catch(() => {
        // Roll back only if we're still the latest intent for this id.
        if (!isLatest()) return;
        setFavorites((prev) => {
          const s = new Set(prev);
          if (next) s.delete(id); else s.add(id);
          return s;
        });
        setCounts((prev) => ({ ...prev, [id]: Math.max(0, (prev[id] ?? 0) + (next ? -1 : 1)) }));
      });
  }, [favorites]);

  const value = React.useMemo<FavoritesCtx>(
    () => ({
      favorites,
      isFavorite: (id) => favorites.has(id),
      countOf: (id) => counts[id] ?? 0,
      toggle,
      ready,
    }),
    [favorites, counts, toggle, ready],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Safe outside a provider too: returns an inert, empty favorites state. */
export function useFavorites(): FavoritesCtx {
  return (
    React.useContext(Ctx) ?? {
      favorites: new Set(),
      isFavorite: () => false,
      countOf: () => 0,
      toggle: () => {},
      ready: false,
    }
  );
}
