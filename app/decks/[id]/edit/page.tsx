import type { Metadata } from "next";
import Link from "next/link";

import { AppTopnav } from "@/components/app-topnav";
import { DeckEditor } from "@/components/deck-editor";
import { RETURN_TO, resolveReturn, returnLabel, withBack } from "@/lib/return-to";

export const metadata: Metadata = {
  title: "HOSA Vitals - edit deck",
  robots: { index: false },
};

// Direct editing for a deck you own or were granted editor access to
// (Google-Docs-style). The API enforces the permission; the editor component
// shows a friendly denial if it isn't yours to edit.
export default async function DeckEditPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ back?: string }>;
}) {
  const { id } = await params;
  const { back } = await searchParams;
  const backHref = resolveReturn(back, RETURN_TO.flashcards);
  // Trying out your own deck should come back to the editor, which still
  // remembers the list behind it.
  const selfHref = withBack(`/decks/${id}/edit`, backHref);
  const enabled = process.env.VELLUM_DEMO_MODE === "1";
  return (
    <main className="dash-page">
      <AppTopnav>
        <Link href={backHref} className="dash-back">← {returnLabel(backHref)}</Link>
        <Link href={withBack(`/decks/${id}`, selfHref)} className="dash-back">Study this deck</Link>
      </AppTopnav>
      {enabled ? (
        <div className="create-wrap">
          <DeckEditor editId={id} backHref={backHref} selfHref={selfHref} />
        </div>
      ) : (
        <div className="dash"><p className="dash-muted">Editing is disabled on this deployment.</p></div>
      )}
    </main>
  );
}
