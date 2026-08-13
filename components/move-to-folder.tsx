"use client";

import * as React from "react";

import type { Folder } from "@/lib/folders";

/** A small select that files a document into one of the viewer's folders (or
 * removes it). Calls onMoved so the caller can refresh the list. */
export function MoveToFolder({ docId, current, folders, onMoved }: {
  docId: string;
  current?: string;
  folders: Folder[];
  onMoved: () => void;
}) {
  const [busy, setBusy] = React.useState(false);
  // The select is controlled by `current`, so a refused move re-renders it back
  // to the old folder — a silent snap-back that looks exactly like the change
  // never registering. The API refuses for real reasons (someone else's folder,
  // an official one, an expired session), so say that it was refused.
  const [failed, setFailed] = React.useState(false);

  async function move(folderId: string) {
    setBusy(true);
    setFailed(false);
    try {
      const res = await fetch(`/api/doc/${docId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folderId: folderId || null }),
      }).catch(() => null);
      if (res?.ok) onMoved();
      else setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <select
        className="folder-move"
        aria-label="Move to folder"
        value={current ?? ""}
        disabled={busy}
        onChange={(e) => void move(e.target.value)}
      >
        <option value="">No folder</option>
        {folders.map((f) => (
          <option key={f.id} value={f.id}>{f.name}</option>
        ))}
      </select>
      {failed && (
        <span className="upload-error" role="alert">Couldn&apos;t move that. It stayed where it was.</span>
      )}
    </>
  );
}
