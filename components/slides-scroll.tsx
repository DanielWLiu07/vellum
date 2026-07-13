"use client";

import * as React from "react";

/**
 * Custom vertical slide viewer: renders each slide of a Google Slides deck as an
 * image and stacks them, so you scroll straight down the slides - no browser PDF
 * chrome. Slides are lazy-loaded (the server renders a page only when it scrolls
 * into view).
 */
export function SlidesScroll({ id, kind, title }: { id: string; kind: "slides" | "doc" | "pdf"; title: string }) {
  const [pages, setPages] = React.useState<number | null | "error">(null);
  const base = `/api/modules/slides-image?id=${encodeURIComponent(id)}&kind=${kind}`;

  React.useEffect(() => {
    let live = true;
    fetch(base, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (live) setPages(typeof j?.pages === "number" && j.pages > 0 ? j.pages : "error"); })
      .catch(() => { if (live) setPages("error"); });
    return () => { live = false; };
  }, [base]);

  if (pages === null) return <div className="slides-scroll-status">Loading slides...</div>;
  if (pages === "error") {
    return (
      <div className="module-note">
        Couldn&apos;t load these slides. Make sure the deck is shared &quot;anyone with the link&quot; so it can be rendered.
      </div>
    );
  }
  return (
    <div className="slides-scroll">
      {Array.from({ length: pages }, (_, k) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={k}
          className="slides-scroll-page"
          loading="lazy"
          src={`${base}&page=${k + 1}`}
          alt={`${title} - page ${k + 1}`}
        />
      ))}
    </div>
  );
}
