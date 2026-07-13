import type { Metadata } from "next";
import Link from "next/link";

import { QuizAttempts } from "@/components/quiz-attempts";
import { ProfileBadge } from "@/components/profile-badge";

export const metadata: Metadata = {
  title: "HOSA Vitals - exam attempts",
  robots: { index: false },
};

// Owner/admin review of exam attempts: scores + integrity timelines. The API
// enforces that only the quiz owner or an admin can read them.
export default async function QuizAttemptsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const enabled = process.env.VELLUM_DEMO_MODE === "1";
  return (
    <main className="dash-page">
      <nav className="dash-topnav">
        <Link href="/" className="dash-brand">HOSA Vitals</Link>
        <span className="dash-topnav-links">
          <Link href="/dashboard" className="dash-back">Dashboard</Link>
          <Link href={`/quizzes/${id}/edit`} className="dash-back">Edit quiz</Link>
          <ProfileBadge />
        </span>
      </nav>
      {enabled ? (
        <QuizAttempts quizId={id} />
      ) : (
        <div className="dash"><p className="dash-muted">Disabled on this deployment.</p></div>
      )}
    </main>
  );
}
