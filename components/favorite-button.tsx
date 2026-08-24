"use client";

import * as React from "react";

import { useFavorites } from "./favorites-context";

/**
 * Heart toggle with the global like-count, overlaid on a card's thumbnail.
 *
 * The heart is OUTLINED when unsaved and SOLID when saved. It used to be a
 * CSS-drawn silhouette that was solid in both states, separated only by a
 * colour swap from --ink-soft to --maroon — two dark colours on a white pill,
 * at 15px. Every card therefore read as already-saved, which is a lie the
 * "Saved" tab then contradicts with a count of 0. Fill is the state; colour
 * only reinforces it.
 */
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
      <svg className="fav-heart" viewBox="-1.2 -1.2 18.4 18.4" aria-hidden="true" focusable="false">
        <path d="M8 1.314C12.438-3.248 23.534 4.735 8 15 -7.534 4.736 3.562-3.248 8 1.314z" />
      </svg>
      {count > 0 && <span className="fav-count">{count}</span>}
    </button>
  );
}
