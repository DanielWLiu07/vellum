"use client";

import * as React from "react";

import type { Folder } from "@/lib/folders";

/** Loads the folders the viewer can see (official + their own) and exposes a
 * create helper. Shared by the resources folder bar and the admin surface. */
export function useFolders() {
  const [folders, setFolders] = React.useState<Folder[]>([]);

  const refresh = React.useCallback(async () => {
    const res = await fetch("/api/folders").catch(() => null);
    const j = res?.ok ? await res.json().catch(() => null) : null;
    if (Array.isArray(j?.folders)) setFolders(j.folders);
  }, []);

  React.useEffect(() => {
    let live = true;
    fetch("/api/folders")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (live && Array.isArray(j?.folders)) setFolders(j.folders); })
      .catch(() => {});
    return () => { live = false; };
  }, []);

  const create = React.useCallback(
    async (name: string, official = false): Promise<boolean> => {
      const res = await fetch("/api/folders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, official }),
      }).catch(() => null);
      if (res?.ok) await refresh();
      return Boolean(res?.ok);
    },
    [refresh],
  );

  const rename = React.useCallback(
    async (id: string, name: string): Promise<boolean> => {
      const res = await fetch(`/api/folders/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      }).catch(() => null);
      if (res?.ok) await refresh();
      return Boolean(res?.ok);
    },
    [refresh],
  );

  const remove = React.useCallback(
    async (id: string): Promise<boolean> => {
      const res = await fetch(`/api/folders/${id}`, { method: "DELETE" }).catch(() => null);
      if (res?.ok) await refresh();
      return Boolean(res?.ok);
    },
    [refresh],
  );

  return { folders, refresh, create, rename, remove };
}
