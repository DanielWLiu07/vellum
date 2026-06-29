import type { Metadata } from "next";
import Link from "next/link";

import { DeckStudy } from "@/components/deck-study";

export const metadata: Metadata = {
  title: "Vitals - study",
  description: "Study a flashcard deck.",
};

export default async function DeckPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const enabled = process.env.VELLUM_DEMO_MODE === "1";
  return (
    <main className="dash-page">
      <nav className="dash-topnav">
        <Link href="/" className="dash-brand">Vitals</Link>
        <span className="dash-topnav-links">
          <Link href="/dashboard" className="dash-back">Dashboard</Link>
          <Link href="/upload" className="dash-back">Add content</Link>
        </span>
      </nav>
      {enabled ? (
        <DeckStudy deckId={id} />
      ) : (
        <div className="dash"><p className="dash-muted">Disabled on this deployment.</p></div>
      )}
    </main>
  );
}
