"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";

import {
  currentSeason,
  filterGuidelines,
  groupGuidelines,
  seasonFromParam,
} from "@/lib/guidelines-list";
import { OFFICIAL_GUIDELINES, type OfficialGuideline } from "@/lib/official-guidelines";

/** Small muted "leaves Vitals" mark at the end of a row. Inline so it survives
 *  a strict CSP; decorative, since the heading says it once in words. */
function ExternalMark() {
  return (
    <svg
      className="guide-row-ext"
      viewBox="0 0 24 24"
      width="15"
      height="15"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable="false"
    >
      <path d="M14 4h6v6" />
      <path d="M20 4 11 13" />
      <path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
    </svg>
  );
}

function GuidelineRow({ g }: { g: OfficialGuideline }) {
  return (
    <li>
      <a className="guide-row" href={g.url} target="_blank" rel="noreferrer noopener">
        <span className="guide-row-title">{g.title}</span>
        {g.archived && <span className="guide-row-badge">Archived copy</span>}
        <ExternalMark />
      </a>
    </li>
  );
}

function GuidelineGroup({ label, items }: { label: string; items: OfficialGuideline[] }) {
  if (items.length === 0) return null;
  return (
    <>
      <h3 className="guide-group">{label}</h3>
      <ul className="guide-list">
        {items.map((g) => <GuidelineRow key={g.url} g={g} />)}
      </ul>
    </>
  );
}

/**
 * Official HOSA Canada event guidelines.
 *
 * The task here is "find the guidelines for MY event" — a competitor already
 * knows the name. So this lands straight on the current season's documents and
 * leads with a filter box, rather than making them click a folder and then
 * visually scan three screens of identical PDF icons. Seasons are a compact
 * control, not a navigation level: there are only four, and nearly everyone
 * wants the newest.
 *
 * Data is the static manifest (lib/official-guidelines.ts) — external PDFs
 * opened in a new tab; no bytes stored here.
 */
export function OfficialGuidelinesView() {
  const searchParams = useSearchParams();
  // ?year= is a bonus deep-link; anything unknown falls back to the current
  // season, which is also the default.
  const [year, setYear] = useState(() => seasonFromParam(searchParams.get("year")));
  const [q, setQ] = useState("");

  const season = OFFICIAL_GUIDELINES.find((s) => s.year === year) ?? OFFICIAL_GUIDELINES[0]!;
  const total = season.items.length;
  const matches = filterGuidelines(season.items, q);
  const { general, events } = groupGuidelines(matches);
  const filtering = matches.length !== total;

  function pickYear(next: string) {
    setYear(next);
    // Keep the rest of the dashboard's query (role/section) intact.
    const p = new URLSearchParams(window.location.search);
    p.set("year", next);
    window.history.replaceState(null, "", `${window.location.pathname}?${p}`);
  }

  return (
    <section>
      <div className="section-head">
        <h2 className="section-title">Official event guidelines</h2>
        <span className="section-count">
          {filtering ? `${matches.length} of ${total}` : `${total} documents`}
        </span>
      </div>
      <p className="dash-sub">
        HOSA Canada competitive event guidelines for {season.year}. Every document is a PDF and opens
        in a new tab.
      </p>

      <div className="guide-controls">
        <div className="year-pills" role="tablist" aria-label="Season">
          {OFFICIAL_GUIDELINES.map((s) => {
            const active = s.year === year;
            return (
              <button
                key={s.year}
                type="button"
                role="tab"
                aria-selected={active}
                className={`year-pill${active ? " is-active" : ""}`}
                data-testid={`guidelines-year-${s.year}`}
                onClick={() => pickYear(s.year)}
              >
                {s.year}
                {s.year === currentSeason() && <span className="year-pill-tag">Current</span>}
              </button>
            );
          })}
        </div>
        <input
          className="search-input guide-search"
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by event name"
          aria-label="Filter guidelines by name"
        />
      </div>

      {matches.length === 0 ? (
        <div className="empty-state">
          No guidelines match that search. Try part of the event name, like &ldquo;nutrition&rdquo;.
        </div>
      ) : (
        <>
          <GuidelineGroup label="General" items={general} />
          <GuidelineGroup label="Event guidelines" items={events} />
        </>
      )}
    </section>
  );
}
