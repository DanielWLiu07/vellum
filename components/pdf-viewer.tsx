"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { decodeClaimsUnsafe, type ClientClaims } from "@/lib/claims-client";

// pdf.js is loaded dynamically (client only) so it never touches the server bundle.
type PdfDoc = { numPages: number; getPage: (n: number) => Promise<PdfPage> };
type PdfPage = {
  getViewport: (o: { scale: number }) => { width: number; height: number };
  render: (o: { canvasContext: CanvasRenderingContext2D; viewport: unknown }) => { promise: Promise<void> };
};

type Mode = "scroll" | "slides";
type Status = "loading" | "ready" | "error";

const MIN_SCALE = 0.5;
const MAX_SCALE = 3;

export function PdfViewer({ proxyUrl = "/api/proxy" }: { proxyUrl?: string }) {
  const [status, setStatus] = useState<Status>("loading");
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [claims, setClaims] = useState<ClientClaims | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [page, setPage] = useState(1);
  const [scale, setScale] = useState(1.2);
  const [mode, setMode] = useState<Mode>("scroll");
  const [fitWidth, setFitWidth] = useState(true);
  const [isFull, setIsFull] = useState(false);
  const [showThumbs, setShowThumbs] = useState(false);

  const docRef = useRef<PdfDoc | null>(null);
  const docBytesRef = useRef<ArrayBuffer | null>(null);
  const kindRef = useRef<"pdf" | "image">("pdf");
  const containerRef = useRef<HTMLDivElement | null>(null);
  const thumbsRef = useRef<HTMLDivElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // ---- Load: read token from the URL fragment, fetch bytes via the proxy. ----
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const hash = window.location.hash.replace(/^#/, "");
        const params = new URLSearchParams(hash);
        const token = params.get("t");
        if (!token) throw new Error("No document token. This viewer must be opened with a signed link.");

        const decoded = decodeClaimsUnsafe(token);
        if (!cancelled && decoded) setClaims(decoded);
        if (params.get("mode") === "slides") setMode("slides");

        const res = await fetch(proxyUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ t: token }),
        });
        if (!res.ok) {
          const reason = await res.json().catch(() => ({}));
          throw new Error(humanError(res.status, reason?.error));
        }
        const buf = await res.arrayBuffer();
        // Keep the original bytes for a permitted download; pdf.js may detach
        // the buffer it's handed, so give it a copy.
        docBytesRef.current = buf;

        // Images render directly to canvas (same secure model as PDF pages) -
        // skip pdf.js.
        const h = new Uint8Array(buf.slice(0, 12));
        const isImage =
          (h[0] === 0x89 && h[1] === 0x50) || // PNG
          (h[0] === 0xff && h[1] === 0xd8) || // JPEG
          (h[0] === 0x47 && h[1] === 0x49) || // GIF
          (h[0] === 0x52 && h[8] === 0x57 && h[9] === 0x45); // WEBP (RIFF...WEBP)
        if (isImage) {
          kindRef.current = "image";
          if (cancelled) return;
          setNumPages(1);
          setStatus("ready");
          return;
        }
        kindRef.current = "pdf";

        const pdfjs = await loadPdfjs();
        const doc = (await pdfjs.getDocument({ data: buf.slice(0) }).promise) as unknown as PdfDoc;
        if (cancelled) return;
        docRef.current = doc;
        setNumPages(doc.numPages);
        setStatus("ready");
      } catch (err) {
        if (cancelled) return;
        setErrorMsg(err instanceof Error ? err.message : "Failed to load document.");
        setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [proxyUrl]);

  // ---- Render pages whenever the doc / scale / mode / page changes. ----
  const renderPages = useCallback(async () => {
    const container = containerRef.current;
    if (!container) return;
    const wm = claims?.wm ?? "";

    // Image documents: draw the single image to a canvas + watermark it.
    if (kindRef.current === "image") {
      const bytes = docBytesRef.current;
      if (!bytes) return;
      const url = URL.createObjectURL(new Blob([bytes]));
      const img = new Image();
      await new Promise<void>((resolve) => {
        img.onload = () => resolve();
        img.onerror = () => resolve();
        img.src = url;
      });
      container.replaceChildren();
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.floor(img.naturalWidth * scale));
      canvas.height = Math.max(1, Math.floor(img.naturalHeight * scale));
      canvas.className = "vellum-page";
      canvas.dataset.page = "1";
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        if (wm) stampWatermark(ctx, canvas.width, canvas.height, wm);
      }
      URL.revokeObjectURL(url);
      container.appendChild(canvas);
      return;
    }

    const doc = docRef.current;
    if (!doc) return;
    container.replaceChildren();

    const pages = mode === "slides" ? [page] : range(1, doc.numPages);
    for (const n of pages) {
      const pdfPage = await doc.getPage(n);
      const viewport = pdfPage.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      canvas.className = "vellum-page";
      canvas.dataset.page = String(n);
      const ctx = canvas.getContext("2d");
      if (!ctx) continue;
      await pdfPage.render({ canvasContext: ctx, viewport }).promise;
      if (wm) stampWatermark(ctx, canvas.width, canvas.height, wm);
      container.appendChild(canvas);
    }
  }, [claims, mode, page, scale]);

  // Jump to a page from the thumbnail rail: in scroll mode, scroll the page
  // into view; in slides mode, switch to it.
  const onJump = useCallback((n: number) => {
    setPage(n);
    if (mode === "scroll") {
      containerRef.current
        ?.querySelector(`canvas[data-page="${n}"]`)
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [mode]);

  useEffect(() => {
    if (status === "ready") void renderPages();
  }, [status, renderPages]);

  // ---- Render the thumbnail rail when it's open. ----
  useEffect(() => {
    if (status !== "ready" || !showThumbs) return;
    const doc = docRef.current;
    const rail = thumbsRef.current;
    if (!doc || !rail) return;
    let cancelled = false;
    (async () => {
      rail.replaceChildren();
      for (let n = 1; n <= doc.numPages; n++) {
        if (cancelled) return;
        const pdfPage = await doc.getPage(n);
        const vp = pdfPage.getViewport({ scale: 0.2 });
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "vellum-thumb";
        btn.dataset.page = String(n);
        btn.setAttribute("aria-label", `Go to page ${n}`);
        btn.addEventListener("click", () => onJump(n));
        const canvas = document.createElement("canvas");
        canvas.width = Math.floor(vp.width);
        canvas.height = Math.floor(vp.height);
        const ctx = canvas.getContext("2d");
        if (ctx) await pdfPage.render({ canvasContext: ctx, viewport: vp }).promise;
        const label = document.createElement("span");
        label.className = "vellum-thumb-label";
        label.textContent = String(n);
        btn.append(canvas, label);
        if (!cancelled) rail.appendChild(btn);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [status, showThumbs, onJump]);

  // ---- Keep the active thumbnail highlighted as the page changes. ----
  useEffect(() => {
    thumbsRef.current?.querySelectorAll<HTMLElement>(".vellum-thumb").forEach((el) => {
      el.classList.toggle("is-active", el.dataset.page === String(page));
    });
  }, [page, showThumbs]);

  // ---- Lock down save/print/right-click/selection. ----
  useEffect(() => {
    const allowPrint = claims?.perms?.print ?? false;
    const onContext = (e: MouseEvent) => e.preventDefault();
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if ((e.metaKey || e.ctrlKey) && (k === "s" || (k === "p" && !allowPrint))) {
        e.preventDefault();
      }
      if (mode === "slides") {
        if (k === "arrowright" || k === " ") setPage((p) => Math.min(numPages, p + 1));
        if (k === "arrowleft") setPage((p) => Math.max(1, p - 1));
      }
      if (e.metaKey || e.ctrlKey) return;
      if (k === "f") {
        if (document.fullscreenElement) void document.exitFullscreen();
        else void rootRef.current?.requestFullscreen?.();
      }
      if (k === "+" || k === "=") {
        setFitWidth(false);
        setScale((s) => Math.min(MAX_SCALE, +(s + 0.2).toFixed(2)));
      }
      if (k === "-" || k === "_") {
        setFitWidth(false);
        setScale((s) => Math.max(MIN_SCALE, +(s - 0.2).toFixed(2)));
      }
    };
    document.addEventListener("contextmenu", onContext);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("contextmenu", onContext);
      document.removeEventListener("keydown", onKey);
    };
  }, [claims, mode, numPages]);

  // ---- Fit-to-width: derive scale from the container + first page's native
  // width, recomputed on load and on resize while fit mode is on. ----
  useEffect(() => {
    if (status !== "ready" || !fitWidth) return;
    let cancelled = false;
    const recompute = async () => {
      const doc = docRef.current;
      const container = containerRef.current;
      if (!doc || !container) return;
      const native = (await doc.getPage(1)).getViewport({ scale: 1 }).width;
      const avail = container.clientWidth - 56; // matches .vellum-scroll padding
      if (cancelled || native <= 0 || avail <= 0) return;
      setScale(Math.min(MAX_SCALE, Math.max(0.25, +(avail / native).toFixed(3))));
    };
    void recompute();
    const onResize = () => void recompute();
    window.addEventListener("resize", onResize);
    return () => {
      cancelled = true;
      window.removeEventListener("resize", onResize);
    };
  }, [status, fitWidth, showThumbs]);

  // ---- Fullscreen state mirror. ----
  useEffect(() => {
    const onChange = () => setIsFull(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggleFull = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void rootRef.current?.requestFullscreen?.();
  };

  // Explicit zoom turns off fit mode so the user's choice sticks across resizes.
  const zoom = (delta: number) => {
    setFitWidth(false);
    setScale((s) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, +(s + delta).toFixed(2))));
  };

  // Only reachable when the token granted perms.download - saves the original
  // bytes we already fetched (no second proxy round-trip).
  const onDownload = () => {
    const bytes = docBytesRef.current;
    if (!bytes) return;
    const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "document.pdf";
    a.click();
    URL.revokeObjectURL(url);
  };

  // Only reachable when perms.print - the print stylesheet hides the chrome and
  // prints just the rendered pages.
  const onPrint = () => window.print();

  const perms = claims?.perms ?? { download: false, print: false, copy: false };

  if (status === "error") {
    return (
      <div className="vellum-state" role="alert">
        <div className="vellum-state-card">
          <p className="vellum-state-title">Can&rsquo;t open this document</p>
          <p className="vellum-state-msg">{errorMsg}</p>
        </div>
      </div>
    );
  }

  const allowCopy = claims?.perms?.copy ?? false;

  return (
    <div ref={rootRef} className={`vellum-root${allowCopy ? "" : " vellum-noselect"}`}>
      <Toolbar
        mode={mode}
        setMode={setMode}
        page={page}
        numPages={numPages}
        setPage={setPage}
        scale={scale}
        zoom={zoom}
        fitWidth={fitWidth}
        toggleFitWidth={() => setFitWidth((f) => !f)}
        isFull={isFull}
        toggleFull={toggleFull}
        showThumbs={showThumbs}
        toggleThumbs={() => setShowThumbs((s) => !s)}
        canDownload={perms.download}
        onDownload={onDownload}
        canPrint={perms.print}
        onPrint={onPrint}
        loading={status === "loading"}
      />
      <div className="vellum-body">
        {showThumbs && <div className="vellum-thumbs" ref={thumbsRef} aria-label="Page thumbnails" role="navigation" />}
        <div className="vellum-scroll" ref={containerRef} aria-busy={status === "loading"} />
      </div>
      {status === "loading" && (
        <div className="vellum-state">
          <div className="vellum-spinner" aria-label="Loading document" />
        </div>
      )}
    </div>
  );
}

function Toolbar(props: {
  mode: Mode;
  setMode: (m: Mode) => void;
  page: number;
  numPages: number;
  setPage: (fn: (p: number) => number) => void;
  scale: number;
  zoom: (delta: number) => void;
  fitWidth: boolean;
  toggleFitWidth: () => void;
  isFull: boolean;
  toggleFull: () => void;
  showThumbs: boolean;
  toggleThumbs: () => void;
  canDownload: boolean;
  onDownload: () => void;
  canPrint: boolean;
  onPrint: () => void;
  loading: boolean;
}) {
  const { mode, setMode, page, numPages, setPage, scale, zoom, fitWidth, toggleFitWidth, isFull, toggleFull, showThumbs, toggleThumbs, canDownload, onDownload, canPrint, onPrint, loading } = props;
  return (
    <div className="vellum-toolbar">
      <div className="vellum-toolbar-group">
        <button
          type="button"
          className={`vellum-btn${showThumbs ? " vellum-btn-active" : ""}`}
          onClick={toggleThumbs}
          disabled={loading}
          aria-pressed={showThumbs}
        >
          Pages
        </button>
        <button
          type="button"
          className="vellum-btn"
          onClick={() => setMode(mode === "slides" ? "scroll" : "slides")}
          disabled={loading}
        >
          {mode === "slides" ? "Scroll view" : "Slideshow"}
        </button>
      </div>
      {mode === "slides" && (
        <div className="vellum-toolbar-group">
          <button
            type="button"
            className="vellum-btn"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={loading || page <= 1}
            aria-label="Previous page"
          >
            ‹
          </button>
          <span className="vellum-pageno">
            {page} / {numPages || "-"}
          </span>
          <button
            type="button"
            className="vellum-btn"
            onClick={() => setPage((p) => Math.min(numPages, p + 1))}
            disabled={loading || page >= numPages}
            aria-label="Next page"
          >
            ›
          </button>
        </div>
      )}
      <div className="vellum-toolbar-group">
        <button
          type="button"
          className="vellum-btn"
          onClick={() => zoom(-0.2)}
          disabled={loading}
          aria-label="Zoom out"
        >
          −
        </button>
        <span className="vellum-zoom">{Math.round(scale * 100)}%</span>
        <button
          type="button"
          className="vellum-btn"
          onClick={() => zoom(0.2)}
          disabled={loading}
          aria-label="Zoom in"
        >
          +
        </button>
        <button
          type="button"
          className={`vellum-btn${fitWidth ? " vellum-btn-active" : ""}`}
          onClick={toggleFitWidth}
          disabled={loading}
          aria-pressed={fitWidth}
        >
          Fit width
        </button>
      </div>
      <div className="vellum-toolbar-group">
        {canPrint && (
          <button type="button" className="vellum-btn" onClick={onPrint} disabled={loading}>
            Print
          </button>
        )}
        {canDownload && (
          <button type="button" className="vellum-btn" onClick={onDownload} disabled={loading}>
            Download
          </button>
        )}
        <button
          type="button"
          className="vellum-btn"
          onClick={toggleFull}
          disabled={loading}
          aria-label={isFull ? "Exit full screen" : "Full screen"}
        >
          {isFull ? "Exit full screen" : "Full screen"}
        </button>
      </div>
    </div>
  );
}

// Diagonal, tiled, low-alpha watermark baked into the page pixels - survives
// screenshots and can't be removed by deleting a DOM node.
function stampWatermark(ctx: CanvasRenderingContext2D, w: number, h: number, text: string) {
  ctx.save();
  ctx.globalAlpha = 0.12;
  ctx.fillStyle = "#126289";
  ctx.font = `${Math.max(14, Math.round(w / 38))}px ui-sans-serif, system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.translate(w / 2, h / 2);
  ctx.rotate(-Math.PI / 6);
  const stepX = 360;
  const stepY = 150;
  for (let y = -h; y < h; y += stepY) {
    for (let x = -w; x < w; x += stepX) {
      ctx.fillText(text, x, y);
    }
  }
  ctx.restore();
}

function range(a: number, b: number): number[] {
  const out: number[] = [];
  for (let i = a; i <= b; i++) out.push(i);
  return out;
}

function humanError(status: number, reason?: string): string {
  if (status === 410 || reason === "expired") return "This link has expired. Reopen the document from the app.";
  if (status === 401) return "This link isn't valid.";
  if (status === 502) return "The document source couldn't be reached.";
  if (status === 413) return "This document is too large to display.";
  return "Something went wrong loading the document.";
}

let pdfjsPromise: Promise<{ getDocument: (o: { data: ArrayBuffer }) => { promise: Promise<unknown> } }> | null = null;
async function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import("pdfjs-dist").then((pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
      return pdfjs as unknown as { getDocument: (o: { data: ArrayBuffer }) => { promise: Promise<unknown> } };
    });
  }
  return pdfjsPromise;
}
