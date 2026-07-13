import type { Metadata } from "next";
import Link from "next/link";

import { AuthPanel } from "@/components/auth-panel";
import { ProfileForm } from "@/components/profile-form";
import { ProfileBadge } from "@/components/profile-badge";
import { ThemeSelect } from "@/components/theme-select";

export const metadata: Metadata = {
  title: "HOSA Vitals - your profile",
  description: "Set up your name, photo, and chapter on Vitals.",
};

export default function ProfilePage() {
  const enabled = process.env.VELLUM_DEMO_MODE === "1";
  return (
    <main className="dash-page">
      <nav className="dash-topnav">
        <Link href="/" className="dash-brand">HOSA Vitals</Link>
        <span className="dash-topnav-links">
          <Link href="/dashboard" className="dash-back">Dashboard</Link>
          <Link href="/upload" className="dash-back">Upload</Link>
          <ProfileBadge />
        </span>
      </nav>
      {enabled ? (
        <>
          <div className="profile-auth-wrap"><AuthPanel /></div>
          <ProfileForm />
          <ThemeSelect />
        </>
      ) : (
        <div className="dash"><p className="dash-muted">Profiles are disabled on this deployment.</p></div>
      )}
    </main>
  );
}
