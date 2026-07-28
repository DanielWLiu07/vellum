import type { Metadata } from "next";

import { AppShell } from "@/components/app-shell";
import { AuthPanel } from "@/components/auth-panel";
import { ProfileForm } from "@/components/profile-form";
import { ThemeSelect } from "@/components/theme-select";
import { roleFromParam } from "@/lib/nav";

export const metadata: Metadata = {
  title: "HOSA Vitals - your profile",
  description: "Set up your name, photo, and chapter on Vitals.",
};

export default async function ProfilePage({ searchParams }: { searchParams: Promise<{ role?: string }> }) {
  const { role } = await searchParams;
  const enabled = process.env.VELLUM_DEMO_MODE === "1";
  return (
    <AppShell role={roleFromParam(role)} active="profile">
      {enabled ? (
        <>
          <div className="profile-auth-wrap"><AuthPanel /></div>
          <ProfileForm />
          <ThemeSelect />
        </>
      ) : (
        <p className="dash-muted">Profiles are disabled on this deployment.</p>
      )}
    </AppShell>
  );
}
