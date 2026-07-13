"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";

type ModuleMeta = { id: string; title: string; summary?: string; sectionCount: number; subsectionCount: number; linkedCount: number; owner: string };

export function ModulesLobby({ admin }: { admin: boolean }) {
  const [modules, setModules] = React.useState<ModuleMeta[] | null>(null);
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
      if (j?.id) router.push(`/modules/${j.id}/edit`);
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
          {modules.map((m) => (
            <div key={m.id} className="tile">
              <div className="tile-info">
                <p className="tile-title">{m.title}</p>
                <p className="tile-sub">
                  {m.summary ? `${m.summary} · ` : ""}{m.sectionCount} section{m.sectionCount === 1 ? "" : "s"} · {m.subsectionCount} subsection{m.subsectionCount === 1 ? "" : "s"} · {m.linkedCount} deck{m.linkedCount === 1 ? "" : "s"} linked
                </p>
              </div>
              <div className="tile-actions">
                <Link className="btn primary" href={`/modules/${m.id}`}>Start</Link>
                {admin && m.id !== "sample-module" && <Link className="btn" href={`/modules/${m.id}/edit`}>Edit</Link>}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
