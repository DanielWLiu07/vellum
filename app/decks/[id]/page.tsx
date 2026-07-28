import type { Metadata } from "next";
import Link from "next/link";

import { AppTopnav } from "@/components/app-topnav";
import { DeckStudy } from "@/components/deck-study";
import { RETURN_TO, resolveReturn, returnLabel } from "@/lib/return-to";

export const metadata: Metadata = {
  title: "HOSA Vitals - study",
  description: "Study a flashcard deck.",
};

export default async function DeckPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ back?: string }>;
}) {
  const { id } = await params;
  const { back } = await searchParams;
  const backHref = resolveReturn(back, RETURN_TO.flashcards);
  const enabled = process.env.VELLUM_DEMO_MODE === "1";
  return (
    <main className="dash-page">
      <AppTopnav>
        <Link href={backHref} className="dash-back">← {returnLabel(backHref)}</Link>
      </AppTopnav>
      {enabled ? (
        <DeckStudy deckId={id} backHref={backHref} />
      ) : (
        <div className="dash"><p className="dash-muted">Disabled on this deployment.</p></div>
      )}
    </main>
  );
}
