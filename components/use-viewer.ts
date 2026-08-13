"use client";

/**
 * The signed-in member, in the shape the permission helpers expect.
 *
 * The dashboard used to pass DEMO_VIEWER — a hardcoded { owner: "you",
 * chapter: "Toronto Central" } — into every canEdit / canManageSharing /
 * filterScoped call. Against a real session (owner "hosa_…", chapter a cuid)
 * none of it matched, so the "Mine" tab came up empty, Edit and Share and
 * Delete never appeared on your own files, and chapter-scoped resources from
 * your actual chapter were filtered out of the list.
 *
 * The server was always right — /api/docs scopes by the real session — so this
 * only ever hid things that were legitimately there. It never leaked anything.
 */

import { useMemo } from "react";

import type { Viewer } from "@/lib/visibility";

import { useMe } from "./use-assignments";

/**
 * Nobody, used only for the instant before /api/auth/me answers. Failing
 * closed here means a card can briefly lack its Edit button; failing open
 * would flash buttons that then vanish, which reads as a bug.
 */
const LOADING: Viewer = { owner: "", chapter: "", admin: false };

export function useViewer(): Viewer {
  const me = useMe();
  return useMemo<Viewer>(
    () =>
      me
        ? { owner: me.id, chapter: me.chapter ?? "", admin: me.role === "admin" }
        : LOADING,
    [me],
  );
}
