import type { Metadata } from "next";
import Link from "next/link";

import { DeckEditor } from "@/components/deck-editor";
import { ProfileBadge } from "@/components/profile-badge";

export const metadata: Metadata = {
  title: "HOSA Vitals - edit deck",
  robots: { index: false },
};

// Direct editing for a deck you own or were granted editor access to
// (Google-Docs-style). The API enforces the permission; the editor component
// shows a friendly denial if it isn't yours to edit.
export default async function DeckEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const enabled = process.env.VELLUM_DEMO_MODE === "1";
  return (
    <main className="dash-page">
      <nav className="dash-topnav">
        <Link href="/" className="dash-brand">HOSA Vitals</Link>
        <span className="dash-topnav-links">
          <Link href="/dashboard" className="dash-back">Dashboard</Link>
          <Link href={`/decks/${id}`} className="dash-back">Study this deck</Link>
          <ProfileBadge />
        </span>
      </nav>
      {enabled ? (
        <div className="create-wrap">
          <DeckEditor editId={id} />
        </div>
      ) : (
        <div className="dash"><p className="dash-muted">Editing is disabled on this deployment.</p></div>
      )}
    </main>
  );
}
