"use client";

import Link from "next/link";
import * as React from "react";

import type { DeckMeta } from "@/lib/decks";

export function FlashcardsView() {
  const [decks, setDecks] = React.useState<DeckMeta[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [busyId, setBusyId] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    const res = await fetch("/api/decks", { cache: "no-store" }).catch(() => null);
    if (res?.ok) setDecks((await res.json()).decks);
    setLoading(false);
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  React.useEffect(() => { void load(); }, [load]);

  async function del(id: string) {
    if (busyId) return;
    if (typeof window !== "undefined" && !window.confirm("Delete this deck?")) return;
    setBusyId(id);
    setDecks((d) => d.filter((x) => x.id !== id));
    const res = await fetch(`/api/decks/${id}`, { method: "DELETE" }).catch(() => null);
    if (!res?.ok) await load();
    setBusyId(null);
  }

  return (
    <section className="role-section">
      <div className="section-head">
        <h2>Flashcards</h2>
        <Link className="cta" href="/upload?type=flashcards">+ Create flashcards</Link>
      </div>
      <p className="dash-sub" style={{ marginTop: -4, marginBottom: 12 }}>
        Shared decks every member can study. Create your own or import from Quizlet / Anki / CSV.
      </p>
      {loading ? (
        <div className="empty-state">Loading...</div>
      ) : decks.length === 0 ? (
        <div className="empty-state">No decks yet - create the first one.</div>
      ) : (
        <div className="tile-grid">
          {decks.map((d) => (
            <div key={d.id} className="tile" data-testid={`deck-${d.id}`}>
              <div className="tile-thumb">
                <div className="tile-preview"><span className="tile-preview-title">{d.title}</span></div>
              </div>
              <div className="tile-info">
                <p className="tile-title">{d.title}</p>
                <p className="tile-sub">{d.cardCount} card{d.cardCount === 1 ? "" : "s"}</p>
              </div>
              <div className="tile-actions">
                <Link className="btn primary" href={`/decks/${d.id}`}>Study</Link>
                {d.id !== "sample-deck" && (
                  <button type="button" className="btn" disabled={busyId === d.id} onClick={() => del(d.id)}>Delete</button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
