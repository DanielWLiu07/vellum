"use client";

import Link from "next/link";
import * as React from "react";

import { VISIBILITIES, type Visibility } from "@/lib/visibility";

const MAX_BYTES = 25 * 1024 * 1024;

export function UploadForm() {
  const [file, setFile] = React.useState<File | null>(null);
  const [name, setName] = React.useState("");
  const [visibility, setVisibility] = React.useState<Visibility>("public");
  const [chapter, setChapter] = React.useState("");
  const [watermark, setWatermark] = React.useState("");
  const [download, setDownload] = React.useState(false);
  const [print, setPrint] = React.useState(false);
  const [slides, setSlides] = React.useState(false);
  const [ttl, setTtl] = React.useState(15);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<{ id: string; name: string } | null>(null);
  const [link, setLink] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);
  const [drag, setDrag] = React.useState(false);
  const [ack, setAck] = React.useState(false);
  const [thumbnailId, setThumbnailId] = React.useState<string | undefined>();
  const [thumbBusy, setThumbBusy] = React.useState(false);
  const fileRef = React.useRef<HTMLInputElement>(null);
  const thumbRef = React.useRef<HTMLInputElement>(null);

  async function pickThumb(f: File | null | undefined) {
    if (!f) return;
    setThumbBusy(true);
    try {
      const fd = new FormData();
      fd.set("file", f);
      const res = await fetch("/api/images", { method: "POST", body: fd });
      if (res.ok) setThumbnailId((await res.json()).id);
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
      fd.set("visibility", visibility);
      if (visibility === "chapter" && chapter.trim()) fd.set("chapter", chapter.trim());
      if (thumbnailId) fd.set("thumbnailId", thumbnailId);
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(
          j.error === "too_large" ? "File too large (25 MB max)." :
          j.error === "not_pdf" ? "That isn't a valid PDF." :
          j.error === "rate_limited" ? "Too many uploads - try again shortly." :
          "Upload failed.",
        );
        return;
      }
      const doc = await res.json();
      setResult({ id: doc.id, name: doc.name });
    } finally {
      setBusy(false);
    }
  }

  async function makeLink() {
    if (!result) return;
    const res = await fetch("/api/share", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: result.id, watermark, download, print, mode: slides ? "slides" : "scroll", ttlMinutes: ttl }),
    });
    if (res.ok) setLink(location.origin + (await res.json()).embedUrl);
  }

  if (result) {
    return (
      <div className="upload-card">
        <span className="pill">Uploaded</span>
        <h1 className="upload-h">{result.name} is in the shared pool</h1>
        <p className="dash-sub">Every member can now find it under Resources. Generate a secure, watermarked link to share it directly:</p>
        <div className="upload-actions">
          <button type="button" className="cta" onClick={makeLink}>Generate secure link</button>
          {link && (
            <button type="button" className="cta secondary" onClick={() => { void navigator.clipboard.writeText(link).catch(() => {}); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
              {copied ? "Copied" : "Copy link"}
            </button>
          )}
        </div>
        {link && <p className="upload-link">{link}</p>}
        <div className="upload-actions">
          <Link className="btn" href="/dashboard">Back to dashboard</Link>
          <button type="button" className="btn" onClick={() => { setResult(null); setFile(null); setName(""); setLink(null); }}>Upload another</button>
        </div>
      </div>
    );
  }

  return (
    <form className="upload-card" onSubmit={handleUpload}>
      <h1 className="upload-h">Upload a document</h1>
      <p className="dash-sub">
        Add a PDF to the shared resource pool. Please follow the{" "}
        <Link href="/guidelines" className="upload-inline-link">content guidelines</Link>.
      </p>

      <div
        className={`drop-zone${drag ? " is-drag" : ""}${file ? " has-file" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); choose(e.dataTransfer.files?.[0]); }}
        onClick={() => fileRef.current?.click()}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") fileRef.current?.click(); }}
        role="button"
        tabIndex={0}
        aria-label="Choose a PDF to upload"
      >
        {file
          ? <p><strong>{file.name}</strong> · {(file.size / 1024).toFixed(0)} KB</p>
          : <p>Drag a PDF or image here, or <span className="upload-inline-link">browse</span> - PDF, PNG, JPG, GIF, WEBP · 25 MB max</p>}
        <input ref={fileRef} type="file" accept="application/pdf,image/png,image/jpeg,image/gif,image/webp" hidden onChange={(e) => choose(e.target.files?.[0])} />
      </div>

      <label className="dash-field"><span>Display name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. ECG interpretation guide" /></label>

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
      </div>

      <div className="upload-settings">
        <p className="upload-settings-title">Who can see it</p>
        <div className="visibility-options">
          {VISIBILITIES.map((v) => (
            <label key={v.id} className={`visibility-option${visibility === v.id ? " is-active" : ""}`}>
              <input type="radio" name="visibility" checked={visibility === v.id} onChange={() => setVisibility(v.id)} />
              <span className="visibility-label">{v.label}</span>
              <span className="visibility-hint">{v.hint}</span>
            </label>
          ))}
        </div>
        {visibility === "chapter" && (
          <label className="dash-field"><span>Chapter</span>
            <input value={chapter} onChange={(e) => setChapter(e.target.value)} placeholder="e.g. Toronto Central" maxLength={80} /></label>
        )}
      </div>

      <div className="upload-settings">
        <p className="upload-settings-title">Sharing settings</p>
        <label className="dash-field"><span>Default watermark (on shared links)</span>
          <input value={watermark} onChange={(e) => setWatermark(e.target.value)} placeholder="e.g. HOSA Canada • confidential" /></label>
        <label className="dash-field"><span>Link expires in (minutes)</span>
          <input type="number" min={1} max={60} value={ttl} onChange={(e) => setTtl(Number(e.target.value) || 1)} /></label>
        <div className="dash-checks">
          <label><input type="checkbox" checked={download} onChange={(e) => setDownload(e.target.checked)} /> Allow download</label>
          <label><input type="checkbox" checked={print} onChange={(e) => setPrint(e.target.checked)} /> Allow print</label>
          <label><input type="checkbox" checked={slides} onChange={(e) => setSlides(e.target.checked)} /> Open as slideshow</label>
        </div>
        <p className="dash-sub" style={{ fontSize: 13 }}>
          Uploads join the shared pool everyone can see. Watermark, expiry, and permissions apply when you generate a secure share link.
        </p>
      </div>

      <div className="upload-warning" role="note">
        <strong>Do not upload copyrighted material you don&apos;t have the right to share.</strong>{" "}
        No textbooks, paid courses, or secured exam/competition content. See the{" "}
        <Link href="/guidelines" className="upload-inline-link">guidelines</Link>.
      </div>
      <label className="upload-ack">
        <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
        <span>I confirm I have the right to share this file and it isn&apos;t copyrighted material I don&apos;t own.</span>
      </label>

      {error && <p className="upload-error" role="alert">{error}</p>}
      <div>
        <button type="submit" className="cta" disabled={busy || !file || !ack}>{busy ? "Uploading..." : "Upload to shared pool"}</button>
      </div>
    </form>
  );
}
