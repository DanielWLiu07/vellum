"use client";

import { useSearchParams } from "next/navigation";

import { dashboardReturn } from "@/lib/return-to";

/**
 * The return target for a link OUT of the dashboard: the spot the member is
 * standing on right now, so finishing a quiz or a module puts them back on the
 * list they started from — same role, same section — instead of on Home.
 *
 * The dashboard mirrors its role + section into the URL as you navigate
 * (history.replaceState, which Next feeds back through useSearchParams), so the
 * current params are the whole story. `fallbackSection` covers the first paint
 * of a plain /dashboard, before anything has been synced.
 */
export function useDashboardReturn(fallbackSection: string): string {
  const params = useSearchParams();
  return dashboardReturn(params.get("role"), params.get("section") ?? fallbackSection);
}
