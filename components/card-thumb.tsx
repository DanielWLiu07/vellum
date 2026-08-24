"use client";

import * as React from "react";

/**
 * A resource card's thumbnail area. Prefers the uploader's cover image, then
 * the auto page-preview (first PDF page / the image itself), then a plain
 * placeholder. Any image load failure falls straight to the placeholder so a
 * card never shows a broken image.
 *
 * `title` is what the placeholder falls back TO. Without it the placeholder is
 * three grey bars — identical on every card, and the whole thumbnail for a deck
 * or a quiz, which can never have a page preview. A grid of those says nothing
 * about the content. Flashcards and Quizzes already print the title into their
 * own placeholder (`.tile-preview-title`); passing it here is the same fix for
 * every card that renders through this component.
 */
type ThumbStage = "cover" | "preview" | "placeholder";

export function CardThumb({ cover, previewId, previewable, badge, favorite, title }: {
  cover?: string;
  previewId?: string;
  previewable?: boolean;
  badge?: React.ReactNode;
  favorite?: React.ReactNode;
  title?: string;
}) {
  const canPreview = Boolean(previewable && previewId);
  const initial: ThumbStage = cover ? "cover" : canPreview ? "preview" : "placeholder";
  const [stage, setStage] = React.useState<ThumbStage>(initial);
  const src = stage === "cover" ? `/api/images/${cover}` : stage === "preview" ? `/api/doc/${previewId}/preview` : null;

  // A broken cover falls through to the page-preview; a broken preview (or a
  // broken cover with no preview) falls to the placeholder.
  function onError() {
    setStage((s) => (s === "cover" && canPreview ? "preview" : "placeholder"));
  }

  return (
    <div className="tile-thumb">
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="tile-cover" src={src} alt="" onError={onError} />
      ) : (
        // aria-hidden even with the title in it: `.tile-title` right below
        // carries the same name, and a screen reader reading it twice per card
        // is worse than the silence this replaces.
        <div className="tile-preview" aria-hidden>
          {title ? <span className="tile-preview-title">{title}</span> : <span className="tile-line" />}
          <span className="tile-line" />
          <span className="tile-line short" />
        </div>
      )}
      {badge && <span className="tile-badge">{badge}</span>}
      {favorite}
    </div>
  );
}
