import type { Metadata } from "next";
import Link from "next/link";

import { CreateContent } from "@/components/create-content";

export const metadata: Metadata = {
  title: "Vitals - add content",
  description: "Add a document or flashcards to the shared resource pool.",
};

export default function UploadPage() {
  const enabled = process.env.VELLUM_DEMO_MODE === "1";
  return (
    <main className="dash-page">
      <nav className="dash-topnav">
        <Link href="/" className="dash-brand">Vitals</Link>
        <span className="dash-topnav-links">
          <Link href="/dashboard" className="dash-back">Dashboard</Link>
          <Link href="/guidelines" className="dash-back">Guidelines</Link>
        </span>
      </nav>
      {enabled ? (
        <CreateContent />
      ) : (
        <div className="dash"><p className="dash-muted">Uploading is disabled on this deployment.</p></div>
      )}
    </main>
  );
}
