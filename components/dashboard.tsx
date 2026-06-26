"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface Doc {
  id: string;
  name: string;
  sizeBytes: number;
  uploadedAt: number;
  bundled: boolean;
}

interface ShareOpts {
  watermark: string;
  download: boolean;
  print: boolean;
  slides: boolean;
  ttlMinutes: number;
}

const DEFAULT_OPTS: ShareOpts = { watermark: "", download: false, print: false, slides: false, ttlMinutes: 15 };

export function Dashboard() {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [selected, setSelected] = useState<{ id: string; url: string } | null>(null);
  const [shareFor, setShareFor] = useState<string | null>(null);
  const [opts, setOpts] = useState<ShareOpts>(DEFAULT_OPTS);
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/docs", { cache: "no-store" });
      if (!res.ok) throw new Error("Dashboard is disabled on this deployment.");
      setDocs((await res.json()).docs);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to load.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const onUpload = async (file: File) => {
    setUploading(true);
    setErr(null);
    try {
      const fd = new FormData();
      fd.set("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(uploadError(e?.error));
      }
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  };

  const mintShare = async (id: string, o: ShareOpts): Promise<string | null> => {
    const res = await fetch("/api/share", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, watermark: o.watermark, download: o.download, print: o.print, mode: o.slides ? "slides" : "scroll", ttlMinutes: o.ttlMinutes }),
    });
    if (!res.ok) return null;
    return (await res.json()).embedUrl as string;
  };

  const onView = async (id: string) => {
    const url = await mintShare(id, DEFAULT_OPTS);
    if (url) setSelected({ id, url });
  };

  const onCopyLink = async () => {
    if (!shareFor) return;
    const url = await mintShare(shareFor, opts);
    if (!url) return;
    const full = `${window.location.origin}${url}`;
    await navigator.clipboard.writeText(full).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div className="dash">
      <header className="dash-head">
        <div>
          <h1>Documents</h1>
          <p className="dash-sub">
            Upload a PDF, generate a watermarked, expiring share link, and view it locked-down — the
            same capability-token flow a host app would drive.
          </p>
        </div>
        <button className="cta" disabled={uploading} onClick={() => fileRef.current?.click()}>
          {uploading ? "Uploading…" : "Upload PDF"}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/pdf"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void onUpload(f);
          }}
        />
      </header>

      {err && <p className="dash-err">{err}</p>}

      <div className="dash-grid">
        <section className="dash-list">
          {loading ? (
            <p className="dash-muted">Loading…</p>
          ) : docs.length === 0 ? (
            <p className="dash-muted">No documents yet — upload one to start.</p>
          ) : (
            <ul>
              {docs.map((d) => (
                <li key={d.id} className={selected?.id === d.id ? "dash-item is-active" : "dash-item"}>
                  <div className="dash-item-main">
                    <span className="dash-item-name">{d.name}</span>
                    <span className="dash-item-meta">
                      {d.bundled ? "Sample" : "Uploaded"} · {(d.sizeBytes / 1024).toFixed(0)} KB
                    </span>
                  </div>
                  <div className="dash-item-actions">
                    <button className="btn" onClick={() => void onView(d.id)}>View</button>
                    <button
                      className="btn"
                      onClick={() => {
                        setShareFor(d.id);
                        setOpts({ ...DEFAULT_OPTS, watermark: "" });
                        setCopied(false);
                      }}
                    >
                      Share…
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="dash-viewer">
          {selected ? (
            <iframe key={selected.url} className="dash-frame" src={selected.url} title="Document viewer" sandbox="allow-scripts allow-same-origin" />
          ) : (
            <div className="dash-empty">Select <strong>View</strong> on a document to open it here.</div>
          )}
        </section>
      </div>

      {shareFor && (
        <div className="dash-modal-backdrop" onClick={() => setShareFor(null)}>
          <div className="dash-modal" onClick={(e) => e.stopPropagation()}>
            <h2>Create a secure link</h2>
            <p className="dash-muted">The link carries a signed token — it expires and can&rsquo;t be tweaked.</p>
            <label className="dash-field">
              <span>Watermark (per-recipient)</span>
              <input value={opts.watermark} placeholder="e.g. Daniel Liu • confidential" onChange={(e) => setOpts({ ...opts, watermark: e.target.value })} />
            </label>
            <label className="dash-field">
              <span>Expires in (minutes)</span>
              <input type="number" min={1} max={60} value={opts.ttlMinutes} onChange={(e) => setOpts({ ...opts, ttlMinutes: Number(e.target.value) })} />
            </label>
            <div className="dash-checks">
              <label><input type="checkbox" checked={opts.download} onChange={(e) => setOpts({ ...opts, download: e.target.checked })} /> Allow download</label>
              <label><input type="checkbox" checked={opts.print} onChange={(e) => setOpts({ ...opts, print: e.target.checked })} /> Allow print</label>
              <label><input type="checkbox" checked={opts.slides} onChange={(e) => setOpts({ ...opts, slides: e.target.checked })} /> Slideshow mode</label>
            </div>
            <div className="dash-modal-actions">
              <button className="cta secondary" onClick={() => setShareFor(null)}>Close</button>
              <button className="cta" onClick={onCopyLink}>{copied ? "Copied ✓" : "Copy share link"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function uploadError(code?: string): string {
  if (code === "too_large") return "That file is too large (25 MB max).";
  if (code === "not_pdf") return "Only PDF files are supported.";
  if (code === "dashboard_disabled") return "The dashboard is disabled on this deployment.";
  return "Upload failed. Try again.";
}
