import type { Metadata } from "next";
import Link from "next/link";

import { AppTopnav } from "@/components/app-topnav";
import { QuizAttempts } from "@/components/quiz-attempts";
import { RETURN_TO, resolveReturn, returnLabel, withBack } from "@/lib/return-to";

export const metadata: Metadata = {
  title: "HOSA Vitals - exam attempts",
  robots: { index: false },
};

// Owner/admin review of exam attempts: scores + integrity timelines. The API
// enforces that only the quiz owner or an admin can read them.
export default async function QuizAttemptsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ back?: string }>;
}) {
  const { id } = await params;
  const { back } = await searchParams;
  const backHref = resolveReturn(back, RETURN_TO.quizzes);
  const enabled = process.env.VELLUM_DEMO_MODE === "1";
  return (
    <main className="dash-page">
      <AppTopnav>
        <Link href={backHref} className="dash-back">← {returnLabel(backHref)}</Link>
        <Link href={withBack(`/quizzes/${id}/edit`, backHref)} className="dash-back">Edit quiz</Link>
      </AppTopnav>
      {enabled ? (
        <QuizAttempts quizId={id} backHref={backHref} />
      ) : (
        <div className="dash"><p className="dash-muted">Disabled on this deployment.</p></div>
      )}
    </main>
  );
}
