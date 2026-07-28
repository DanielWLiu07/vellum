import type { Metadata } from "next";
import Link from "next/link";

import { AppTopnav } from "@/components/app-topnav";
import { QuizEditor } from "@/components/quiz-editor";
import { RETURN_TO, resolveReturn, returnLabel, withBack } from "@/lib/return-to";

export const metadata: Metadata = {
  title: "HOSA Vitals - edit quiz",
  robots: { index: false },
};

// Direct editing for a quiz you own or were granted editor access to
// (Google-Docs-style). The API enforces the permission — including that the
// answer key is only served to editors.
export default async function QuizEditPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ back?: string }>;
}) {
  const { id } = await params;
  const { back } = await searchParams;
  const backHref = resolveReturn(back, RETURN_TO.quizzes);
  // Previewing your own quiz should come back HERE, so the editor hands the
  // taker a target that points at this page (which still remembers the list).
  const selfHref = withBack(`/quizzes/${id}/edit`, backHref);
  const enabled = process.env.VELLUM_DEMO_MODE === "1";
  return (
    <main className="dash-page">
      <AppTopnav>
        <Link href={backHref} className="dash-back">← {returnLabel(backHref)}</Link>
        <Link href={withBack(`/quizzes/${id}`, selfHref)} className="dash-back">Take this quiz</Link>
      </AppTopnav>
      {enabled ? (
        <div className="create-wrap">
          <QuizEditor editId={id} backHref={backHref} selfHref={selfHref} />
        </div>
      ) : (
        <div className="dash"><p className="dash-muted">Editing is disabled on this deployment.</p></div>
      )}
    </main>
  );
}
