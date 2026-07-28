"use client";

import * as React from "react";

/**
 * A resource card's thumbnail area. Prefers the uploader's cover image, then
 * the auto page-preview (first PDF page / the image itself), then a plain
 * placeholder. Any image load failure falls straight to the placeholder so a
 * card never shows a broken image.
 */
type ThumbStage = "cover" | "preview" | "placeholder";

export function CardThumb({ cover, previewId, previewable, badge, favorite }: {
  cover?: string;
  previewId?: string;
  previewable?: boolean;
  badge?: React.ReactNode;
  favorite?: React.ReactNode;
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
        <div className="tile-preview" aria-hidden>
          <span className="tile-line" />
          <span className="tile-line" />
          <span className="tile-line short" />
        </div>
      )}
      {badge && <span className="tile-badge">{badge}</span>}
      {favorite}
    </div>
  );
}
