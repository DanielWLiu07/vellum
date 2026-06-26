import type { Metadata } from "next";
import Link from "next/link";

import { Dashboard } from "@/components/dashboard";

export const metadata: Metadata = {
  title: "Vellum — dashboard",
  description: "Upload, manage, and securely share documents with Vellum.",
};

export default function DashboardPage() {
  const enabled = process.env.VELLUM_DEMO_MODE === "1";
  return (
    <main className="dash-page">
      <nav className="dash-topnav">
        <Link href="/" className="dash-brand">Vellum</Link>
        <Link href="/" className="dash-back">← Back to overview</Link>
      </nav>
      {enabled ? (
        <Dashboard />
      ) : (
        <div className="dash"><p className="dash-muted">The dashboard is disabled on this deployment.</p></div>
      )}
    </main>
  );
}
