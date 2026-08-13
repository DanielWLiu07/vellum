"use client";

import Link from "next/link";
import * as React from "react";

import { RETURN_TO, returnLabel, withBack } from "@/lib/return-to";

const MAX_BYTES = 25 * 1024 * 1024;

interface UploadResult {
  id: string;
  name: string;
  /** Stored, but private until a reviewer clears it. See moderation-queue. */
  heldForReview: boolean;
  /** "flagged" = moderation objected; "unchecked" = nobody has looked yet. */
  holdReason?: "flagged" | "unchecked";
  categories: string[];
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * A refusal names what to do about it, which depends on WHICH check refused.
 * The old copy always said "flagged this title ... please rename it" — useless
 * advice when it was the picture inside the file that was refused.
 */
function contentFlaggedMessage(source: unknown, categories: unknown): string {
  const list = Array.isArray(categories) && categories.length ? ` (${categories.join(", ")})` : "";
  return source === "title"
    ? `Content moderation flagged the title or event name${list}. Please rename it and try again.`
    : `Content moderation flagged what's inside this file${list}, so it can't be uploaded.`;
}

export function UploadForm({ backHref = RETURN_TO.resources }: {
  /** Validated destination once the upload is done (see lib/return-to). */
  backHref?: string;
}) {
  const backLabel = returnLabel(backHref);
  const [file, setFile] = React.useState<File | null>(null);
  const [name, setName] = React.useState("");
  const [event, setEvent] = React.useState("");
  const [noPreview, setNoPreview] = React.useState(false);
  const [watermark, setWatermark] = React.useState("");
  const [download, setDownload] = React.useState(false);
  const [print, setPrint] = React.useState(false);
  const [slides, setSlides] = React.useState(false);
  const [ttl, setTtl] = React.useState(15);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<UploadResult | null>(null);
  const [link, setLink] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);
  const [drag, setDrag] = React.useState(false);
  const [ack, setAck] = React.useState(false);
  const [thumbnailId, setThumbnailId] = React.useState<string | undefined>();
  const [thumbBusy, setThumbBusy] = React.useState(false);
  const [preview, setPreview] = React.useState<string | null>(null);
  const [docUrl, setDocUrl] = React.useState<string | null>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);
  const thumbRef = React.useRef<HTMLInputElement>(null);

  // Live preview of the chosen file (image OR pdf) - so you see the resource as
  // you upload it. `preview` also feeds the small thumb for images. Revoke the
  // object URL on change so we don't leak.
  /* eslint-disable react-hooks/set-state-in-effect */
  React.useEffect(() => {
    if (!file) { setPreview(null); setDocUrl(null); return; }
    const isImg = file.type.startsWith("image/");
    const isPdf = file.type === "application/pdf";
    if (isImg || isPdf) {
      const url = URL.createObjectURL(file);
      if (isImg) setPreview(url);
      else setPreview(null);
      setDocUrl(url);
      return () => URL.revokeObjectURL(url);
    }
    setPreview(null);
    setDocUrl(null);
  }, [file]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // /api/images moderates covers, so it refuses for real reasons. Dropping
  // those left the button back at "+ Add a cover image" with no cover and no
  // explanation, which reads as the click not registering. Same refusals, same
  // wording as the avatar picker in profile-form.
  async function pickThumb(f: File | null | undefined) {
    if (!f) return;
    setError(null);
    setThumbBusy(true);
    try {
      const fd = new FormData();
      fd.set("file", f);
      const res = await fetch("/api/images", { method: "POST", body: fd }).catch(() => null);
      if (res?.ok) {
        setThumbnailId((await res.json()).id);
        return;
      }
      const j = (await res?.json().catch(() => null)) ?? {};
      setError(
        j.error === "content_flagged"
          ? `That cover image was flagged by content moderation${Array.isArray(j.categories) && j.categories.length ? ` (${j.categories.join(", ")})` : ""}. Please choose another.`
          : j.error === "too_large" ? "That cover image is too large (5 MB max)."
          : j.error === "not_image" ? "Please choose a PNG, JPG, GIF, or WEBP cover image."
          : "Could not upload that cover image.",
      );
    } finally {
      setThumbBusy(false);
    }
  }

  function choose(f: File | null | undefined) {
    setError(null);
    if (!f) return;
    const ok = f.type === "application/pdf" || f.type.startsWith("image/");
    if (!ok) return setError("PDFs and images only (PDF, PNG, JPG, GIF, WEBP).");
    if (f.size > MAX_BYTES) return setError("Maximum size is 25 MB.");
    setFile(f);
    if (!name.trim()) setName(f.name.replace(/\.(pdf|png|jpe?g|gif|webp)$/i, ""));
  }

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return setError("Choose a file to upload.");
    if (!ack) return setError("Please confirm you have the right to share this file.");
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.set("file", file);
      if (name.trim()) fd.set("name", name.trim());
      if (event.trim()) fd.set("event", event.trim());
      if (noPreview) fd.set("noPreview", "1");
      if (thumbnailId) fd.set("thumbnailId", thumbnailId);
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(
          j.error === "too_large" ? "File too large (25 MB max)." :
          j.error === "not_pdf" ? "That isn't a valid PDF." :
          j.error === "rate_limited" ? "Too many uploads - try again shortly." :
          j.error === "content_flagged"
            ? contentFlaggedMessage(j.source, j.categories)
            :
          j.error === "copyright_flagged"
            ? `This looks like copyrighted material${Array.isArray(j.signals) && j.signals.length ? ` (${j.signals.join(", ")})` : ""} and can't be uploaded. Only share resources you have the right to distribute.`
            :
          "Upload failed.",
        );
        return;
      }
      const doc = await res.json();
      setResult({
        id: doc.id,
        name: doc.name,
        heldForReview: Boolean(doc.heldForReview),
        holdReason: doc.holdReason,
        categories: Array.isArray(doc.categories) ? doc.categories : [],
      });
    } finally {
      setBusy(false);
    }
  }

  // A refused or unreachable /api/share used to fall out of this function
  // silently: no link appeared, no message did either, and the button sat there
  // looking idle. An unhandled rejection was the only trace, and only offline.
  async function makeLink() {
    if (!result) return;
    setError(null);
    const res = await fetch("/api/share", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: result.id, watermark, download, print, mode: slides ? "slides" : "scroll", ttlMinutes: ttl }),
    }).catch(() => null);
    if (!res?.ok) {
      setError("Couldn't generate a link just now. Try again.");
      return;
    }
    setLink(location.origin + (await res.json()).embedUrl);
  }

  if (result) {
    return (
      <div className="upload-card">
        <span className="upload-done-badge" aria-hidden="true" />
        {/* Uploads are stored PRIVATE (see the route: the owner shares them
            afterward). The old copy said "is in the shared pool ... every
            member can now find it", which was wrong for every upload. */}
        <h1 className="upload-h">
          {result.heldForReview ? `${result.name} is uploaded, and held for review` : `${result.name} is uploaded`}
        </h1>

        {result.heldForReview ? (
          <>
            <p className="dash-sub">
              {result.holdReason === "flagged"
                ? `Automatic moderation flagged this${result.categories.length ? ` (${result.categories.join(", ")})` : ""}, so a reviewer will take a look before it can be shared.`
                : "Automatic moderation couldn't examine all of this file, so a reviewer will look before it can be shared."}
            </p>
            {/* Say what the hold does and doesn't cost, or "held" reads as
                "confiscated" — the file is stored and still theirs to open. */}
            <p className="dash-sub">
              It&apos;s saved and you can open it any time. Sharing is what&apos;s paused: secure
              links stay unavailable until a reviewer clears it.
            </p>
          </>
        ) : (
          <>
            <p className="dash-sub">It&apos;s private to you. Generate a secure link to share it:</p>
            {/* These live here, not on the upload form, because here is where
                they take effect. On the form they were labelled "Default
                watermark" and similar, but nothing carried them into the
                upload — they were only ever read by makeLink on this screen,
                and were discarded entirely when a file was held for review. A
                setting that isn't a default shouldn't call itself one.
                Each control also drops the generated link, so what's on screen
                is never a link minted under settings since changed: otherwise
                toggling "Allow print" left the old link sitting there looking
                current, which is the same problem one screen later. */}
            <div className="upload-settings">
              <p className="upload-settings-title">Link settings</p>
              <label className="dash-field"><span>Watermark</span>
                <input value={watermark} onChange={(e) => { setWatermark(e.target.value); setLink(null); }} placeholder="e.g. HOSA Canada • confidential" /></label>
              <label className="dash-field"><span>Link expires in (minutes)</span>
                <input type="number" min={1} max={60} value={ttl} onChange={(e) => { setTtl(Number(e.target.value) || 1); setLink(null); }} /></label>
              <div className="dash-checks">
                <label><input type="checkbox" checked={download} onChange={(e) => { setDownload(e.target.checked); setLink(null); }} /> Allow download</label>
                <label><input type="checkbox" checked={print} onChange={(e) => { setPrint(e.target.checked); setLink(null); }} /> Allow print</label>
                <label><input type="checkbox" checked={slides} onChange={(e) => { setSlides(e.target.checked); setLink(null); }} /> Open as slideshow</label>
              </div>
            </div>
            <div className="upload-actions">
              <button type="button" className="cta" onClick={makeLink}>Generate secure link</button>
              {link && (
                <button type="button" className="cta secondary" onClick={() => { void navigator.clipboard.writeText(link).catch(() => {}); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
                  {copied ? "Copied" : "Copy link"}
                </button>
              )}
            </div>
            {error && <p className="upload-error" role="alert">{error}</p>}
            {link && <p className="upload-link">{link}</p>}
          </>
        )}
        {/* Finishing an upload lands on the thing you just made, or on the list
            it joined — never back on an empty form you didn't ask for. */}
        <div className="upload-actions">
          <Link className="btn primary" href={withBack(`/view/${result.id}`, backHref)}>Open it</Link>
          <button type="button" className="btn" onClick={() => { setResult(null); setFile(null); setName(""); setLink(null); setError(null); }}>Upload another</button>
        </div>
        <Link className="dash-back" href={backHref}>← {backLabel}</Link>
      </div>
    );
  }

  return (
    <form className="upload-card" onSubmit={handleUpload}>
      <h1 className="upload-h">Upload a document</h1>
      <p className="dash-sub">Add a PDF or image. It stays private to you until you share it.</p>

      {file ? (
        <div className="file-card">
          <div className="file-thumb">
            {preview ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={preview} alt="" />
            ) : (
              <span className="file-ext">{(file.name.split(".").pop() || "file").toUpperCase().slice(0, 4)}</span>
            )}
          </div>
          <div className="file-meta">
            <p className="file-name">{file.name}</p>
            <p className="file-size">{formatSize(file.size)}</p>
            <button type="button" className="file-replace" onClick={() => fileRef.current?.click()}>Replace file</button>
          </div>
          <button type="button" className="file-remove" aria-label="Remove file" onClick={() => { setFile(null); setError(null); }} />
        </div>
      ) : null}

      {docUrl && (
        <div className="upload-preview">
          <p className="upload-preview-label">Preview</p>
          {file?.type === "application/pdf" ? (
            // sandbox (no allow-scripts) neutralizes any active content if the
            // file isn't really a PDF - defense in depth for the local preview.
            <iframe className="upload-preview-frame" src={docUrl} title="Document preview" sandbox="allow-same-origin" />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="upload-preview-img" src={docUrl} alt="Selected file preview" />
          )}
        </div>
      )}

      {!file && (
        <div
          className={`drop-zone${drag ? " is-drag" : ""}`}
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); choose(e.dataTransfer.files?.[0]); }}
          onClick={() => fileRef.current?.click()}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") fileRef.current?.click(); }}
          role="button"
          tabIndex={0}
          aria-label="Choose a PDF or image to upload"
        >
          <span className="drop-icon" aria-hidden="true" />
          <p className="drop-title">Drag a file here, or <span className="upload-inline-link">browse</span></p>
          <p className="drop-meta">PDF, PNG, JPG, GIF, WEBP - up to 25 MB</p>
        </div>
      )}
      <input ref={fileRef} type="file" accept="application/pdf,image/png,image/jpeg,image/gif,image/webp" hidden onChange={(e) => choose(e.target.files?.[0])} />

      <label className="dash-field"><span>Display name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. ECG interpretation guide" /></label>

      <label className="dash-field"><span>Event (optional)</span>
        <input value={event} onChange={(e) => setEvent(e.target.value)} placeholder="e.g. Medical Terminology" /></label>

      <div className="dash-field">
        <span>Cover image (optional)</span>
        {thumbnailId ? (
          <div className="card-img">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/api/images/${thumbnailId}`} alt="Cover preview" />
            <button type="button" className="card-img-remove" onClick={() => setThumbnailId(undefined)}>Remove cover</button>
          </div>
        ) : (
          <div>
            <button type="button" className="card-img-add" onClick={() => thumbRef.current?.click()} disabled={thumbBusy}>
              {thumbBusy ? "Uploading..." : "+ Add a cover image"}
            </button>
            <input ref={thumbRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden onChange={(e) => pickThumb(e.target.files?.[0])} />
          </div>
        )}
        {!thumbnailId && (
          <label className="upload-inline-check">
            <input type="checkbox" checked={noPreview} onChange={(e) => setNoPreview(e.target.checked)} />
            <span>Use a plain cover instead of a page preview</span>
          </label>
        )}
      </div>

      <div className="upload-note">
        Your upload stays <strong>private</strong> to you. You can share it with your chapter or
        everyone afterward from <strong>My resources</strong>.
      </div>

      <div className="upload-warning" role="note">
        <strong>Do not upload copyrighted material you don&apos;t have the right to share.</strong>{" "}
        No textbooks, paid courses, or secured exam/competition content.
      </div>
      <label className="upload-ack">
        <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
        <span>I confirm I have the right to share this file and it isn&apos;t copyrighted material I don&apos;t own.</span>
      </label>

      {error && <p className="upload-error" role="alert">{error}</p>}
      <button type="submit" className="cta block" disabled={busy || !file || !ack}>{busy ? "Uploading..." : "Upload"}</button>
    </form>
  );
}
