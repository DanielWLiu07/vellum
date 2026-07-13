import type { Metadata } from "next";
import Link from "next/link";

import { ModuleEditor } from "@/components/module-editor";
import { ProfileBadge } from "@/components/profile-badge";

export const metadata: Metadata = {
  title: "HOSA Vitals - edit module",
  robots: { index: false },
};

export default async function ModuleEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const enabled = process.env.VELLUM_DEMO_MODE === "1";
  return (
    <main className="dash-page">
      <nav className="dash-topnav">
        <Link href="/" className="dash-brand">HOSA Vitals</Link>
        <span className="dash-topnav-links">
          <Link href="/dashboard?section=modules" className="dash-back">Modules</Link>
          <Link href={`/modules/${id}`} className="dash-back">Play this module</Link>
          <ProfileBadge />
        </span>
      </nav>
      {enabled ? (
        <ModuleEditor moduleId={id} />
      ) : (
        <div className="dash"><p className="dash-muted">Editing is disabled on this deployment.</p></div>
      )}
    </main>
  );
}
