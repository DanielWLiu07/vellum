"use client";

import Link from "next/link";
import * as React from "react";

import type { DeckMeta } from "@/lib/decks";
import { withBack } from "@/lib/return-to";
import { canEdit, canManageSharing } from "@/lib/visibility";

import { useViewer } from "./use-viewer";

import { FavoriteButton } from "./favorite-button";
import { ShareDialog, type ShareTarget } from "./share-dialog";
import { useDashboardReturn } from "./use-return-to";

const VIS_LABEL = { public: "Public", chapter: "Chapter", private: "Private" } as const;

export function FlashcardsView() {
  const viewer = useViewer();
  // Study and edit links carry the way back to this list (role + section), so
  // clearing a deck returns here.
  const backHref = useDashboardReturn("flashcards");
  const [decks, setDecks] = React.useState<DeckMeta[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState(false);
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

  // A failed load used to fall through to decks = [], which renders as "No
  // decks yet - create the first one": an outage told as the fact that your
  // library is empty, to someone who may have built it.
  const load = React.useCallback(async () => {
    const res = await fetch("/api/decks", { cache: "no-store" }).catch(() => null);
    if (res?.ok) {
      setDecks((await res.json()).decks);
      setLoadError(false);
    } else {
      setLoadError(true);
    }
    setLoading(false);
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  React.useEffect(() => { void load(); }, [load]);

  // Not optimistic: the tile used to disappear on click and quietly come back
  // if the server refused, which reads as the list glitching rather than the
  // delete being denied. The deck stays until the server confirms.
  async function del(id: string) {
    if (busyId) return;
    if (typeof window !== "undefined" && !window.confirm("Delete this deck?")) return;
    setBusyId(id);
    const res = await fetch(`/api/decks/${id}`, { method: "DELETE" }).catch(() => null);
    setBusyId(null);
    if (!res?.ok) {
      setFlash("Couldn't delete that deck. It's still here.");
      return;
    }
    setDecks((d) => d.filter((x) => x.id !== id));
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
        <Link className="cta" href={withBack("/upload?type=flashcards", backHref)}>+ Create flashcards</Link>
      </div>
      <p className="dash-sub" style={{ marginTop: -4, marginBottom: 12 }}>
        Study decks with Google-Docs-style sharing: make a copy of anything you can see,
        edit what you own, and share with specific people or your whole chapter.
      </p>
      {flash && <p className="dash-sub" role="status" style={{ marginBottom: 12 }}>{flash}</p>}
      {loading ? (
        <div className="empty-state">Loading...</div>
      ) : loadError ? (
        <div className="empty-state">
          Couldn&apos;t load your decks. <button type="button" className="btn" onClick={() => void load()}>Retry</button>
        </div>
      ) : decks.length === 0 ? (
        <div className="empty-state">No decks yet - create the first one.</div>
      ) : (
        <div className="tile-grid">
          {decks.map((d) => {
            const editable = d.id !== "sample-deck" && canEdit(d, viewer);
            const canShare = d.id !== "sample-deck" && canManageSharing(d, viewer);
            const mine = d.owner === viewer.owner;
            return (
              <div key={d.id} className="tile" data-testid={`deck-${d.id}`}>
                <div className="tile-thumb">
                  <div className="tile-preview"><span className="tile-preview-title">{d.title}</span></div>
                  <span className={`tile-badge badge-${d.visibility === "public" ? "ok" : d.visibility === "chapter" ? "warn" : "muted"}`}>
                    {VIS_LABEL[d.visibility]}
                  </span>
                  <FavoriteButton id={d.id} label={d.title} />
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
                  <Link className="btn primary" href={withBack(`/decks/${d.id}`, backHref)}>Study</Link>
                  {editable && <Link className="btn" href={withBack(`/decks/${d.id}/edit`, backHref)}>Edit</Link>}
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
