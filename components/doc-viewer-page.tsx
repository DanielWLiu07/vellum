"use client";

// Dedicated in-app document viewer (/view/[id]) — the full-page counterpart
// to the embeddable /embed surface. Same security model end to end: the
// client asks /api/share for a short-lived signed token (visibility checks +
// rate limit live there), passes it to PdfViewer as a prop (never in the
// URL), and the bytes stream through /api/proxy with the watermark baked in.
// PdfViewer brings the working chrome — scroll/slideshow, zoom, fit width,
// page rail, fullscreen; this page adds the app frame around it: back nav,
// title, ownership/visibility metadata, and friendly error states.

import Link from "next/link";

import { Comments } from "./comments";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { PdfViewer } from "@/components/pdf-viewer";
import { returnLabel, withBack } from "@/lib/return-to";

interface DocMeta {
  id: string;
  name: string;
  sizeBytes: number;
  uploadedAt: number;
  bundled: boolean;
  visibility: "public" | "chapter" | "private";
  chapter: string;
  owner: string;
}

const VIS_LABEL: Record<DocMeta["visibility"], string> = {
  public: "Public",
  chapter: "Chapter",
  private: "Private",
};

type State =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; meta: DocMeta | null; token: string };

/** Pull the signed token out of the `/embed#t=...` URL /api/share returns. */
function tokenFromEmbedUrl(embedUrl: string): string | null {
  const frag = embedUrl.split("#")[1] ?? "";
  return new URLSearchParams(frag).get("t");
}

export function DocViewerPage({
  id,
  backHref = "/dashboard",
  initialMode,
}: {
  id: string;
  /** Validated same-app return target (role + section preserved). */
  backHref?: string;
  /** "slides" makes /view/[id]?mode=slides a shareable presentation link. */
  initialMode?: "scroll" | "slides";
}) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [copying, setCopying] = useState(false);
  const router = useRouter();
  const backLabel = returnLabel(backHref);

  // Google-Docs "Make a copy" from inside the viewer: clone, then open the
  // copy (it's private and yours — the back link still returns to the same
  // dashboard spot).
  async function makeCopy() {
    if (copying) return;
    setCopying(true);
    const res = await fetch(`/api/doc/${id}/copy`, { method: "POST" }).catch(() => null);
    setCopying(false);
    if (res?.ok) {
      const j = await res.json().catch(() => null);
      if (j?.id) router.push(withBack(`/view/${j.id}`, backHref));
    }
  }

  useEffect(() => {
    let cancelled = false;
    // Reset on id change — App Router soft-navigation between /view/A and
    // /view/B reuses this component instance, and stale `ready` state would
    // briefly show A's document under B's URL (review finding). Same
    // deliberate sync-set the dashboard's deep-link effect uses.
    /* eslint-disable-next-line react-hooks/set-state-in-effect */
    setState({ kind: "loading" });
    (async () => {
      try {
        // Meta (for the header) and the token can load together; meta is
        // best-effort — the viewer works without it.
        const [shareRes, docsRes] = await Promise.all([
          fetch("/api/share", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            // Shortest practical TTL: PdfViewer fetches the bytes exactly
            // once right after mount and never re-uses the token, so a
            // long-lived bearer is pure downside (review finding). A reload
            // simply mints a fresh one.
            body: JSON.stringify({ id, ttlMinutes: 2 }),
          }),
          fetch("/api/docs", { cache: "no-store" }).catch(() => null),
        ]);

        if (!shareRes.ok) {
          const reason = await shareRes.json().catch(() => ({}));
          const message =
            reason?.error === "dashboard_disabled"
              ? "The dashboard is disabled on this deployment."
              : shareRes.status === 404
              ? "This document doesn't exist (it may have been deleted)."
              : shareRes.status === 403
                ? "You don't have access to this document."
                : shareRes.status === 429
                  ? "Too many viewer requests — wait a moment and reload."
                  : `Couldn't open the document (${reason?.error ?? shareRes.status}).`;
          if (!cancelled) setState({ kind: "error", message });
          return;
        }

        const { embedUrl } = await shareRes.json();
        const token = tokenFromEmbedUrl(embedUrl);
        if (!token) {
          if (!cancelled) {
            setState({ kind: "error", message: "The viewer link came back malformed. Reload to try again." });
          }
          return;
        }

        let meta: DocMeta | null = null;
        if (docsRes?.ok) {
          const j = await docsRes.json().catch(() => null);
          meta = (j?.docs as DocMeta[] | undefined)?.find((d) => d.id === id) ?? null;
        }

        if (!cancelled) setState({ kind: "ready", meta, token });
      } catch {
        if (!cancelled) {
          setState({ kind: "error", message: "Something went wrong opening the document. Reload to try again." });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  return (
    <main className="viewer-page">
      <nav className="dash-topnav viewer-page-nav">
        <Link href="/" className="dash-brand">HOSA Vitals</Link>
        <div className="viewer-page-meta">
          {state.kind === "ready" && (
            <>
              <span className="viewer-page-title" title={state.meta?.name}>
                {state.meta?.name ?? "Document"}
              </span>
              {state.meta && (
                <span className="viewer-page-sub">
                  {state.meta.bundled
                    ? "HOSA official"
                    : `Uploaded by ${state.meta.owner}`}
                  {" · "}
                  {VIS_LABEL[state.meta.visibility]}
                  {" · "}
                  {(state.meta.sizeBytes / 1024).toFixed(0)} KB
                </span>
              )}
            </>
          )}
        </div>
        <span className="dash-topnav-links">
          {state.kind === "ready" && (
            <button type="button" className="dash-back viewer-copy-btn" onClick={makeCopy} disabled={copying}>
              {copying ? "Copying..." : "Make a copy"}
            </button>
          )}
          <Link href={backHref} className="dash-back">← {backLabel}</Link>
        </span>
      </nav>

      {state.kind === "loading" && (
        <div className="viewer-page-status" role="status">Opening the secure viewer…</div>
      )}
      {state.kind === "error" && (
        <div className="viewer-page-status">
          <p>{state.message}</p>
          <p>
            <Link className="btn" href={backHref}>← {backLabel}</Link>
          </p>
        </div>
      )}
      {state.kind === "ready" && (
        <>
          <div className="viewer-page-frame">
            <PdfViewer key={state.token} token={state.token} initialMode={initialMode} />
          </div>
          <div className="viewer-page-comments">
            <Comments type="doc" target={id} />
          </div>
        </>
      )}
    </main>
  );
}
