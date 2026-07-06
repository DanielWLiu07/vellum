"use client";

import Link from "next/link";
import * as React from "react";

import type { DeckMeta } from "@/lib/decks";
import { DEMO_VIEWER, canEdit, canManageSharing } from "@/lib/visibility";

import { ShareDialog, type ShareTarget } from "./share-dialog";

const VIS_LABEL = { public: "Public", chapter: "Chapter", private: "Private" } as const;

export function FlashcardsView() {
  const [decks, setDecks] = React.useState<DeckMeta[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [share, setShare] = React.useState<ShareTarget | null>(null);
  const [flash, setFlashMsg] = React.useState<string | null>(null);
  const flashTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  // Show a transient status line that clears itself (banners that never
  // dismiss pile up across interactions — review finding).
  const setFlash = React.useCallback((msg: string) => {
    setFlashMsg(msg);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlashMsg(null), 4000);
  }, []);
  React.useEffect(() => () => { if (flashTimer.current) clearTimeout(flashTimer.current); }, []);

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

  async function copy(d: DeckMeta) {
    if (busyId) return;
    setBusyId(d.id);
    const res = await fetch(`/api/decks/${d.id}/copy`, { method: "POST" }).catch(() => null);
    if (res?.ok) {
      const j = await res.json();
      setFlash(`Created "${j.title}" (private) - it's yours to edit.`);
      await load();
    } else {
      setFlash("Couldn't copy the deck.");
    }
    setBusyId(null);
  }

  return (
    <section className="role-section">
      <div className="section-head">
        <h2>Flashcards</h2>
        <Link className="cta" href="/upload?type=flashcards">+ Create flashcards</Link>
      </div>
      <p className="dash-sub" style={{ marginTop: -4, marginBottom: 12 }}>
        Study decks with Google-Docs-style sharing: make a copy of anything you can see,
        edit what you own, and share with specific people or your whole chapter.
      </p>
      {flash && <p className="dash-sub" role="status" style={{ marginBottom: 12 }}>{flash}</p>}
      {loading ? (
        <div className="empty-state">Loading...</div>
      ) : decks.length === 0 ? (
        <div className="empty-state">No decks yet - create the first one.</div>
      ) : (
        <div className="tile-grid">
          {decks.map((d) => {
            const editable = d.id !== "sample-deck" && canEdit(d, DEMO_VIEWER);
            const canShare = d.id !== "sample-deck" && canManageSharing(d, DEMO_VIEWER);
            const mine = d.owner === DEMO_VIEWER.owner;
            return (
              <div key={d.id} className="tile" data-testid={`deck-${d.id}`}>
                <div className="tile-thumb">
                  <div className="tile-preview"><span className="tile-preview-title">{d.title}</span></div>
                  <span className={`tile-badge badge-${d.visibility === "public" ? "ok" : d.visibility === "chapter" ? "warn" : "muted"}`}>
                    {VIS_LABEL[d.visibility]}
                  </span>
                </div>
                <div className="tile-info">
                  <p className="tile-title">{d.title}</p>
                  <p className="tile-sub">
                    {d.cardCount} card{d.cardCount === 1 ? "" : "s"}
                    {" · "}
                    {d.owner === "system" ? "HOSA sample" : mine ? "Yours" : `By ${d.owner}`}
                    {d.people.length > 0 ? ` · shared with ${d.people.length}` : ""}
                  </p>
                </div>
                <div className="tile-actions">
                  <Link className="btn primary" href={`/decks/${d.id}`}>Study</Link>
                  {editable && <Link className="btn" href={`/decks/${d.id}/edit`}>Edit</Link>}
                  <button type="button" className="btn" disabled={busyId === d.id} onClick={() => copy(d)}>Make a copy</button>
                  {canShare && (
                    <button
                      type="button"
                      className="btn"
                      onClick={() => setShare({ kind: "deck", id: d.id, name: d.title, visibility: d.visibility, chapter: d.chapter, people: d.people, owner: d.owner })}
                    >
                      Share
                    </button>
                  )}
                  {mine && (
                    <button type="button" className="btn danger" disabled={busyId === d.id} onClick={() => del(d.id)}>Delete</button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {share && (
        <ShareDialog
          target={share}
          onClose={() => setShare(null)}
          onSaved={(m) => { setShare(null); setFlash(m); void load(); }}
        />
      )}
    </section>
  );
}
