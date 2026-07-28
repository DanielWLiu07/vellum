"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";

import { withBack } from "@/lib/return-to";

import { useDashboardReturn } from "./use-return-to";

type ModuleMeta = { id: string; title: string; summary?: string; sectionCount: number; subsectionCount: number; linkedCount: number; owner: string };

/**
 * How far through a module you are, from the same localStorage key the player
 * writes ("vitals-module-progress:<id>": the ids of the subsections ticked off).
 * Read here so finishing a module lands on a list that shows it finished.
 */
function readProgress(ids: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const id of ids) {
    try {
      const raw = localStorage.getItem(`vitals-module-progress:${id}`);
      const done = raw ? JSON.parse(raw) : null;
      if (Array.isArray(done)) out[id] = new Set(done as string[]).size;
    } catch { /* unreadable or not ours - no badge */ }
  }
  return out;
}

export function ModulesLobby({ admin }: { admin: boolean }) {
  // Start / Edit carry the way back to this list, so "Finish" at the end of a
  // module returns to Modules with the role + section intact.
  const backHref = useDashboardReturn("modules");
  const [modules, setModules] = React.useState<ModuleMeta[] | null>(null);
  const [progress, setProgress] = React.useState<Record<string, number>>({});
  const [busy, setBusy] = React.useState(false);
  const router = useRouter();

  const load = React.useCallback(async () => {
    const res = await fetch("/api/modules", { cache: "no-store" }).catch(() => null);
    const j = res?.ok ? await res.json().catch(() => null) : null;
    if (Array.isArray(j?.modules)) setModules(j.modules);
  }, []);

  React.useEffect(() => {
    let live = true;
    fetch("/api/modules", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (live && Array.isArray(j?.modules)) setModules(j.modules); })
      .catch(() => {});
    return () => { live = false; };
  }, []);

  // Progress is per-browser, so it can only be read after mount — doing it in
  // an effect keeps the server and first client render identical.
  React.useEffect(() => {
    if (!modules) return;
    /* eslint-disable-next-line react-hooks/set-state-in-effect */
    setProgress(readProgress(modules.map((m) => m.id)));
  }, [modules]);

  async function newModule() {
    const title = window.prompt("New module title");
    if (!title || !title.trim()) return;
    setBusy(true);
    try {
      const res = await fetch("/api/modules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim() }),
      }).catch(() => null);
      const j = res?.ok ? await res.json().catch(() => null) : null;
      if (j?.id) router.push(withBack(`/modules/${j.id}/edit`, backHref));
      else await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="role-section">
      <div className="section-head">
        <h2>Modules</h2>
        {admin && <button className="cta" disabled={busy} onClick={newModule}>{busy ? "Creating..." : "+ New module"}</button>}
      </div>
      <p className="dash-sub">
        Structured HOSA lessons - work through them section by section. Each module has a slide walkthrough with the
        sections listed down the side.
      </p>

      {modules === null ? (
        <div className="empty-state">Loading...</div>
      ) : modules.length === 0 ? (
        <div className="empty-state">{admin ? "No modules yet. Click + New module to build one." : "No modules published yet."}</div>
      ) : (
        <div className="tile-grid">
          {modules.map((m) => {
            // Clamped: stored progress can name subsections a later edit removed.
            const done = Math.min(progress[m.id] ?? 0, m.subsectionCount);
            const complete = m.subsectionCount > 0 && done >= m.subsectionCount;
            return (
              <div key={m.id} className="tile">
                <div className="tile-info">
                  <p className="tile-title">
                    {m.title}
                    {done > 0 && (
                      <span className={`module-progress-chip${complete ? " is-complete" : ""}`}>
                        {complete ? "Complete" : `${done} of ${m.subsectionCount} done`}
                      </span>
                    )}
                  </p>
                  <p className="tile-sub">
                    {m.summary ? `${m.summary} · ` : ""}{m.sectionCount} section{m.sectionCount === 1 ? "" : "s"} · {m.subsectionCount} subsection{m.subsectionCount === 1 ? "" : "s"} · {m.linkedCount} deck{m.linkedCount === 1 ? "" : "s"} linked
                  </p>
                </div>
                <div className="tile-actions">
                  <Link className="btn primary" href={withBack(`/modules/${m.id}`, backHref)}>
                    {done > 0 && !complete ? "Continue" : complete ? "Review" : "Start"}
                  </Link>
                  {admin && m.id !== "sample-module" && <Link className="btn" href={withBack(`/modules/${m.id}/edit`, backHref)}>Edit</Link>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
