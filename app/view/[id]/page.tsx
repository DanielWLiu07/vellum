import type { Metadata } from "next";

import { DocViewerPage } from "@/components/doc-viewer-page";
import { RETURN_TO, resolveReturn } from "@/lib/return-to";

export const metadata: Metadata = {
  title: "HOSA Vitals - document viewer",
  robots: { index: false, follow: false },
};

// Dedicated in-app viewer for a resource. All authorization happens in the
// APIs the client component calls (/api/share checks visibility + mints the
// short-lived token; /api/proxy verifies it before releasing bytes) — this
// page is just the addressable shell, so a member can deep-link or refresh
// a document like any other page.
export default async function ViewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ back?: string; mode?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  // Only same-app targets, rebuilt from validated pieces — a crafted ?back
  // can't turn the viewer into an open redirect. The check now lives in
  // lib/return-to, shared with every other flow.
  const back = resolveReturn(sp.back, RETURN_TO.dashboard);
  const mode = sp.mode === "slides" ? "slides" : undefined;
  return <DocViewerPage id={id} backHref={back} initialMode={mode} />;
}
