import type { Metadata } from "next";

import { AppShell } from "@/components/app-shell";
import { CreateContent } from "@/components/create-content";
import { roleFromParam } from "@/lib/nav";
import { readReturn } from "@/lib/return-to";

export const metadata: Metadata = {
  title: "HOSA Vitals - add content",
  description: "Add a document or flashcards to the shared resource pool.",
};

export default async function UploadPage({ searchParams }: { searchParams: Promise<{ role?: string; back?: string }> }) {
  const { role, back } = await searchParams;
  const enabled = process.env.VELLUM_DEMO_MODE === "1";
  return (
    <AppShell role={roleFromParam(role)} active="upload">
      {enabled ? (
        // No `?back=` (someone opened Upload from the sidebar) leaves the
        // destination to the form: each kind of content has its own home.
        <CreateContent backHref={readReturn(back)} />
      ) : (
        <p className="dash-muted">Uploading is disabled on this deployment.</p>
      )}
    </AppShell>
  );
}
