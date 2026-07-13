"use client";

import * as React from "react";

import { useFavorites } from "./favorites-context";

/** Heart toggle with the global like-count, overlaid on a card's thumbnail. */
export function FavoriteButton({ id, label }: { id: string; label: string }) {
  const { isFavorite, countOf, toggle } = useFavorites();
  const saved = isFavorite(id);
  const count = countOf(id);
  return (
    <button
      type="button"
      className={`fav-btn${saved ? " is-saved" : ""}${count > 0 ? " has-count" : ""}`}
      aria-pressed={saved}
      aria-label={`${saved ? "Saved" : "Save"} ${label}${count > 0 ? ` - ${count} member${count === 1 ? "" : "s"} saved this` : ""}`}
      title={count > 0 ? `${count} saved` : "Save"}
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggle(id); }}
    >
      <span className="fav-heart" aria-hidden="true" />
      {count > 0 && <span className="fav-count">{count}</span>}
    </button>
  );
}
