"use client";

import * as React from "react";

/**
 * Upload an image to /api/images (which moderates it) and hand back its id.
 * Shared by the flashcard editor (card front/back) and the quiz editor
 * (question prompt). Shows a preview + remove once an image is attached.
 */
export function ImageField({
  id,
  onChange,
  label,
  addLabel = "+ Image",
}: {
  id?: string;
  onChange: (id: string | undefined) => void;
  label: string;
  addLabel?: string;
}) {
  const ref = React.useRef<HTMLInputElement>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function pick(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.set("file", file);
      const res = await fetch("/api/images", { method: "POST", body: fd });
      if (res.ok) {
        onChange((await res.json()).id);
      } else {
        const j = await res.json().catch(() => null);
        setError(
          j?.error === "content_flagged"
            ? `Image flagged by moderation${Array.isArray(j.categories) && j.categories.length ? ` (${j.categories.join(", ")})` : ""}.`
            : "Upload failed.",
        );
      }
    } catch {
      setError("Upload failed.");
    } finally {
      setBusy(false);
    }
  }

  if (id) {
    return (
      <div className="card-img">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`/api/images/${id}`} alt={`${label} image`} />
        <button type="button" className="card-img-remove" onClick={() => onChange(undefined)}>
          Remove image
        </button>
      </div>
    );
  }
  return (
    <>
      <button type="button" className="card-img-add" onClick={() => ref.current?.click()} disabled={busy}>
        {busy ? "Uploading..." : error ? "Try again" : addLabel}
      </button>
      <input
        ref={ref}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        hidden
        onChange={(e) => pick(e.target.files?.[0])}
      />
      {error ? <span className="upload-error" role="alert">{error}</span> : null}
    </>
  );
}
