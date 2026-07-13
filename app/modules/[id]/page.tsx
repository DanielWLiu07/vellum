import type { Metadata } from "next";
import Link from "next/link";

import { ModulePlayer } from "@/components/module-player";
import { ProfileBadge } from "@/components/profile-badge";

export const metadata: Metadata = {
  title: "HOSA Vitals - module",
  description: "Work through a HOSA learning module.",
};

export default async function ModulePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const enabled = process.env.VELLUM_DEMO_MODE === "1";
  return (
    <main className="dash-page">
      <nav className="dash-topnav">
        <Link href="/" className="dash-brand">HOSA Vitals</Link>
        <span className="dash-topnav-links">
          <Link href="/dashboard?section=modules" className="dash-back">Modules</Link>
          <ProfileBadge />
        </span>
      </nav>
      {enabled ? (
        <ModulePlayer moduleId={id} />
      ) : (
        <div className="dash"><p className="dash-muted">Disabled on this deployment.</p></div>
      )}
    </main>
  );
}
