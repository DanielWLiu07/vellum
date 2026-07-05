"use client";

// Official guideline documents, grouped by competitive-season year.
//
// HOSA guidelines are released per season, so the listing buckets by year:
// a season range in the filename ("2024-2025 Sports Medicine Guidelines.pdf")
// wins; otherwise the academic year of the upload date (Sep-Aug) is used.
// Docs qualify by name ("guideline" anywhere, case-insensitive) — the store
// has no category field yet, and the naming convention is already how the
// team labels these files.

import { useCallback, useEffect, useState } from "react";

import { OFFICIAL_GUIDELINES } from "@/lib/official-guidelines";

interface Doc {
  id: string;
  name: string;
  sizeBytes: number;
  uploadedAt: number;
}

/** "2024-2025" | "2024–25" | "2024/25" in the filename → "2024–2025". */
function yearFromName(name: string): string | null {
  const range = name.match(/(20\d{2})\s*[-–/]\s*(20\d{2}|\d{2})/);
  if (range) {
    const start = Number(range[1]);
    const endRaw = range[2]!;
    const end = endRaw.length === 2 ? Number(`${String(start).slice(0, 2)}${endRaw}`) : Number(endRaw);
    if (end === start + 1) return `${start}–${end}`;
  }
  const single = name.match(/\b(20\d{2})\b/);
  if (single) {
    const y = Number(single[1]);
    return `${y}–${y + 1}`;
  }
  return null;
}

/** Academic year of a timestamp (Sep-Aug): Sep 2025 → "2025–2026". */
function academicYear(ts: number): string {
  const d = new Date(ts);
  const start = d.getMonth() >= 8 ? d.getFullYear() : d.getFullYear() - 1;
  return `${start}–${start + 1}`;
}

export function GuidelinesByYear() {
  const [docs, setDocs] = useState<Doc[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/docs")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j) => {
        if (!cancelled) setDocs(j.docs ?? []);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const open = useCallback(async (id: string) => {
    const res = await fetch("/api/share", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, watermark: "", ttlMinutes: 15 }),
    });
    if (res.ok) {
      const { embedUrl } = await res.json();
      window.open(embedUrl, "_blank", "noopener");
    }
  }, []);

  // Member-uploaded guideline docs, grouped like the official set.
  const uploaded = (docs ?? []).filter((d) => /guideline/i.test(d.name));
  const uploadedByYear = new Map<string, Doc[]>();
  for (const d of uploaded) {
    const year = yearFromName(d.name) ?? academicYear(d.uploadedAt);
    const list = uploadedByYear.get(year) ?? [];
    list.push(d);
    uploadedByYear.set(year, list);
  }
  const uploadedYears = [...uploadedByYear.keys()].sort((a, b) => b.localeCompare(a));

  return (
    <div className="guidelines-years">
      {/* Official HOSA Canada guidelines — static manifest, one section per
          season, newest expanded. Links open the source PDF directly. */}
      {OFFICIAL_GUIDELINES.map((season, idx) => (
        <details key={season.year} open={idx === 0}>
          <summary>
            <strong>{season.year}</strong>{" "}
            <span className="dash-sub">({season.items.length} documents)</span>
          </summary>
          <ul>
            {season.items.map((g) => (
              <li key={g.url}>
                <a href={g.url} target="_blank" rel="noreferrer noopener">
                  {g.title}
                </a>
                {g.archived && <span className="dash-sub"> (archived copy)</span>}
              </li>
            ))}
          </ul>
        </details>
      ))}

      {/* Member uploads named like guidelines, if any, under their own year. */}
      {!error && docs === null && (
        <p className="dash-sub">Loading member-uploaded guidelines…</p>
      )}
      {uploadedYears.length > 0 && (
        <>
          <h3>Member-uploaded guidelines</h3>
          {uploadedYears.map((year) => (
            <section key={year}>
              <h4>{year}</h4>
              <ul>
                {uploadedByYear.get(year)!.map((d) => (
                  <li key={d.id}>
                    <button
                      type="button"
                      className="dash-doc-link"
                      onClick={() => void open(d.id)}
                    >
                      {d.name}
                    </button>{" "}
                    <span className="dash-sub">
                      ({(d.sizeBytes / 1024).toFixed(0)} KB)
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </>
      )}
    </div>
  );
}
