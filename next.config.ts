import type { NextConfig } from "next";

// Origins allowed to embed the viewer in an <iframe>. Host apps add their
// origins via VELLUM_FRAME_ANCESTORS (space-separated). `'self'` is ALWAYS
// included — the service's own dashboard and landing demo embed /embed, so
// dropping self-framing would break them. We prepend it and dedupe.
const configuredAncestors = (process.env.VELLUM_FRAME_ANCESTORS ?? "")
  .split(/\s+/)
  .filter((a) => a && a !== "'self'");
const frameAncestors = ["'self'", ...configuredAncestors].join(" ");

const nextConfig: NextConfig = {
  // Self-contained server bundle for Docker/self-hosting (.next/standalone).
  output: "standalone",
  // pdfjs-dist ships a worker we resolve at runtime; keep it external from the
  // server bundle so the canvas/DOM-matrix shims don't get pulled server-side.
  serverExternalPackages: ["pdfjs-dist"],
  async headers() {
    return [
      {
        // The embeddable viewer: allow framing only by approved ancestors and
        // forbid the page itself from being indexed or sniffed.
        source: "/embed",
        headers: [
          {
            key: "Content-Security-Policy",
            value: `frame-ancestors ${frameAncestors};`,
          },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
        ],
      },
      {
        // Proxied document bytes must never be cached by shared caches.
        source: "/api/proxy",
        headers: [
          { key: "Cache-Control", value: "no-store, max-age=0" },
          { key: "X-Content-Type-Options", value: "nosniff" },
        ],
      },
    ];
  },
};

export default nextConfig;
