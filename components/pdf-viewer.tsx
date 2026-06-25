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

  const docRef = useRef<PdfDoc | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

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

        const pdfjs = await loadPdfjs();
        const doc = (await pdfjs.getDocument({ data: buf }).promise) as unknown as PdfDoc;
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
    const doc = docRef.current;
    const container = containerRef.current;
    if (!doc || !container) return;
    container.replaceChildren();

    const wm = claims?.wm ?? "";
    const pages = mode === "slides" ? [page] : range(1, doc.numPages);
    for (const n of pages) {
      const pdfPage = await doc.getPage(n);
      const viewport = pdfPage.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      canvas.className = "vellum-page";
      const ctx = canvas.getContext("2d");
      if (!ctx) continue;
      await pdfPage.render({ canvasContext: ctx, viewport }).promise;
      if (wm) stampWatermark(ctx, canvas.width, canvas.height, wm);
      container.appendChild(canvas);
    }
  }, [claims, mode, page, scale]);

  useEffect(() => {
    if (status === "ready") void renderPages();
  }, [status, renderPages]);

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
    };
    document.addEventListener("contextmenu", onContext);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("contextmenu", onContext);
      document.removeEventListener("keydown", onKey);
    };
  }, [claims, mode, numPages]);

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
    <div className={`vellum-root${allowCopy ? "" : " vellum-noselect"}`}>
      <Toolbar
        mode={mode}
        setMode={setMode}
        page={page}
        numPages={numPages}
        setPage={setPage}
        scale={scale}
        setScale={setScale}
        loading={status === "loading"}
      />
      <div className="vellum-scroll" ref={containerRef} aria-busy={status === "loading"} />
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
  setScale: (fn: (s: number) => number) => void;
  loading: boolean;
}) {
  const { mode, setMode, page, numPages, setPage, scale, setScale, loading } = props;
  return (
    <div className="vellum-toolbar">
      <div className="vellum-toolbar-group">
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
            {page} / {numPages || "–"}
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
          onClick={() => setScale((s) => Math.max(MIN_SCALE, +(s - 0.2).toFixed(2)))}
          disabled={loading}
          aria-label="Zoom out"
        >
          −
        </button>
        <span className="vellum-zoom">{Math.round(scale * 100)}%</span>
        <button
          type="button"
          className="vellum-btn"
          onClick={() => setScale((s) => Math.min(MAX_SCALE, +(s + 0.2).toFixed(2)))}
          disabled={loading}
          aria-label="Zoom in"
        >
          +
        </button>
      </div>
    </div>
  );
}

// Diagonal, tiled, low-alpha watermark baked into the page pixels — survives
// screenshots and can't be removed by deleting a DOM node.
function stampWatermark(ctx: CanvasRenderingContext2D, w: number, h: number, text: string) {
  ctx.save();
  ctx.globalAlpha = 0.16;
  ctx.fillStyle = "#6b7280";
  ctx.font = `${Math.max(14, Math.round(w / 38))}px system-ui, sans-serif`;
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
