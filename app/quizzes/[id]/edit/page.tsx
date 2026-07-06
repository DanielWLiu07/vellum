import type { Metadata } from "next";
import Link from "next/link";

import { QuizEditor } from "@/components/quiz-editor";

export const metadata: Metadata = {
  title: "HOSA Vitals - edit quiz",
  robots: { index: false },
};

// Direct editing for a quiz you own or were granted editor access to
// (Google-Docs-style). The API enforces the permission — including that the
// answer key is only served to editors.
export default async function QuizEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const enabled = process.env.VELLUM_DEMO_MODE === "1";
  return (
    <main className="dash-page">
      <nav className="dash-topnav">
        <Link href="/" className="dash-brand">HOSA Vitals</Link>
        <span className="dash-topnav-links">
          <Link href="/dashboard" className="dash-back">Dashboard</Link>
          <Link href={`/quizzes/${id}`} className="dash-back">Take this quiz</Link>
        </span>
      </nav>
      {enabled ? (
        <div className="create-wrap">
          <QuizEditor editId={id} />
        </div>
      ) : (
        <div className="dash"><p className="dash-muted">Editing is disabled on this deployment.</p></div>
      )}
    </main>
  );
}
