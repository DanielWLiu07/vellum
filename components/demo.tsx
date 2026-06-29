"use client";

import { useState } from "react";

// Live demo widget: asks the demo-token endpoint for a freshly signed token,
// then frames the viewer with it. Mirrors exactly what a host app does, minus
// the presigned-URL step (the demo doc is served from /public).
export function Demo() {
  const [src, setSrc] = useState<string | null>(null);
  const [mode, setMode] = useState<"scroll" | "slides">("scroll");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function open(nextMode: "scroll" | "slides") {
    setLoading(true);
    setErr(null);
    setMode(nextMode);
    try {
      const res = await fetch("/api/demo-token", { cache: "no-store" });
      if (!res.ok) throw new Error("Demo is disabled on this deployment.");
      const { token } = await res.json();
      const hash = new URLSearchParams({ t: token });
      if (nextMode === "slides") hash.set("mode", "slides");
      setSrc(`/embed#${hash.toString()}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to start demo.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <div className="row">
        <button className="cta" onClick={() => open("scroll")} disabled={loading}>
          {loading ? "Loading..." : "Launch demo"}
        </button>
        <button className="cta secondary" onClick={() => open("slides")} disabled={loading}>
          Launch as slideshow
        </button>
      </div>
      {err && <p style={{ color: "#f87171" }}>{err}</p>}
      {src && (
        <iframe
          key={src + mode}
          className="demo-frame"
          src={src}
          title="Vellum viewer demo"
          // Sandboxed: scripts run (the viewer needs them) but the framed page
          // can't navigate the top window or trigger downloads.
          sandbox="allow-scripts allow-same-origin"
        />
      )}
    </div>
  );
}
