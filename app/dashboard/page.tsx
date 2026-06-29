import type { Metadata } from "next";
import Link from "next/link";

import { Dashboard } from "@/components/dashboard";

export const metadata: Metadata = {
  title: "Vitals - dashboard",
  description: "Upload, manage, and securely share documents with Vitals.",
};

export default function DashboardPage() {
  const enabled = process.env.VELLUM_DEMO_MODE === "1";
  return (
    <main className="dash-page">
      <nav className="dash-topnav">
        <Link href="/" className="dash-brand">Vitals</Link>
        <span className="dash-topnav-links">
          <Link href="/upload" className="dash-back">Upload</Link>
          <Link href="/guidelines" className="dash-back">Guidelines</Link>
          <Link href="/" className="dash-back">← Overview</Link>
        </span>
      </nav>
      {enabled ? (
        <Dashboard />
      ) : (
        <div className="dash"><p className="dash-muted">The dashboard is disabled on this deployment.</p></div>
      )}
    </main>
  );
}
