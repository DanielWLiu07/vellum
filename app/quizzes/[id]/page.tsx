import type { Metadata } from "next";
import Link from "next/link";

import { AppTopnav } from "@/components/app-topnav";
import { QuizTake } from "@/components/quiz-take";
import { RETURN_TO, resolveReturn, returnLabel } from "@/lib/return-to";

export const metadata: Metadata = {
  title: "HOSA Vitals - quiz",
  description: "Take a study quiz.",
};

// `?back=` says where finishing (or abandoning) the quiz should land — the
// Quizzes list you opened it from, or the editor if you're previewing your own.
// Absent or untrustworthy, it's the Quizzes list.
export default async function QuizPage({
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
      </AppTopnav>
      {enabled ? (
        <QuizTake quizId={id} backHref={backHref} />
      ) : (
        <div className="dash"><p className="dash-muted">Disabled on this deployment.</p></div>
      )}
    </main>
  );
}
