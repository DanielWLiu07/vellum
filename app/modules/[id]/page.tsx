import type { Metadata } from "next";
import Link from "next/link";

import { AppTopnav } from "@/components/app-topnav";
import { ModulePlayer } from "@/components/module-player";
import { RETURN_TO, resolveReturn, returnLabel } from "@/lib/return-to";

export const metadata: Metadata = {
  title: "HOSA Vitals - module",
  description: "Work through a HOSA learning module.",
};

// The player owns its own section sidebar (that IS the module navigation), so
// this page takes the shared top bar only — no second sidebar stacked beside it.
export default async function ModulePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ back?: string; parts?: string }>;
}) {
  const { id } = await params;
  const { back, parts } = await searchParams;
  const backHref = resolveReturn(back, RETURN_TO.modules);
  const enabled = process.env.VELLUM_DEMO_MODE === "1";
  return (
    <main className="dash-page">
      <AppTopnav>
        <Link href={backHref} className="dash-back">← {returnLabel(backHref)}</Link>
      </AppTopnav>
      {enabled ? (
        <ModulePlayer
          moduleId={id}
          backHref={backHref}
          // ?parts=sec1,sec3 - the sections this student was assigned. The rest
          // of the module stays readable; this only says which part is theirs.
          assignedParts={parts ? parts.split(",").map((x) => x.trim()).filter(Boolean) : undefined}
        />
      ) : (
        <div className="dash"><p className="dash-muted">Disabled on this deployment.</p></div>
      )}
    </main>
  );
}
