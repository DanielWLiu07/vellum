import type { Metadata } from "next";
import { Suspense } from "react";

import { AppTopnav } from "@/components/app-topnav";
import { Dashboard } from "@/components/dashboard";
import { FavoritesProvider } from "@/components/favorites-context";

export const metadata: Metadata = {
  title: "HOSA Vitals - dashboard",
  description: "Upload, manage, and securely share documents with Vitals.",
};

export default function DashboardPage() {
  const enabled = process.env.VELLUM_DEMO_MODE === "1";
  return (
    <main className="dash-page">
      <AppTopnav />
      {enabled ? (
        <FavoritesProvider>
          {/* Dashboard reads ?section= via useSearchParams, which opts its
              subtree into client rendering — the boundary keeps that bailout
              from swallowing the prerendered chrome above it. */}
          <Suspense fallback={<div className="dash" />}>
            <Dashboard />
          </Suspense>
        </FavoritesProvider>
      ) : (
        <div className="dash"><p className="dash-muted">The dashboard is disabled on this deployment.</p></div>
      )}
    </main>
  );
}
