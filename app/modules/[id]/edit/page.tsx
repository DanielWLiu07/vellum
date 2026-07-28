import type { Metadata } from "next";
import Link from "next/link";

import { AppTopnav } from "@/components/app-topnav";
import { ModuleEditor } from "@/components/module-editor";
import { RETURN_TO, resolveReturn, returnLabel, withBack } from "@/lib/return-to";

export const metadata: Metadata = {
  title: "HOSA Vitals - edit module",
  robots: { index: false },
};

// Like the player, the editor owns its own section sidebar, so this page takes
// the shared top bar only.
export default async function ModuleEditPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ back?: string }>;
}) {
  const { id } = await params;
  const { back } = await searchParams;
  const backHref = resolveReturn(back, RETURN_TO.modules);
  // Playing the module you're editing should come back to the editor.
  const selfHref = withBack(`/modules/${id}/edit`, backHref);
  const enabled = process.env.VELLUM_DEMO_MODE === "1";
  return (
    <main className="dash-page">
      <AppTopnav>
        <Link href={backHref} className="dash-back">← {returnLabel(backHref)}</Link>
        <Link href={withBack(`/modules/${id}`, selfHref)} className="dash-back">Play this module</Link>
      </AppTopnav>
      {enabled ? (
        <ModuleEditor moduleId={id} backHref={backHref} selfHref={selfHref} />
      ) : (
        <div className="dash"><p className="dash-muted">Editing is disabled on this deployment.</p></div>
      )}
    </main>
  );
}
