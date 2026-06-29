import Link from "next/link";

import { Demo } from "@/components/demo";

export default function Home() {
  const demoEnabled = process.env.VELLUM_DEMO_MODE === "1";
  return (
    <main className="landing">
      <span className="pill">microservice · pdf.js · zero-knowledge</span>
      <h1>Vellum</h1>
      <p className="tagline">
        A stateless, zero-knowledge secure document viewer. Embed gated PDFs with per-user
        watermarking and download prevention - without handing the viewer your data or your keys.
      </p>

      {demoEnabled && (
        <div className="row">
          <Link href="/dashboard" className="cta">Open the dashboard →</Link>
          <a href="#how" className="cta secondary">How it works</a>
        </div>
      )}

      <p style={{ marginTop: 8, color: "var(--ink-soft)", fontSize: 14 }}>
        Two ways to use it: a standalone <Link href="/dashboard" style={{ color: "var(--maroon)" }}>dashboard</Link>{" "}
        to upload, manage, and securely share your own documents - or an <em>embedded</em> stateless
        viewer a host app drives with signed tokens (the demo below).
      </p>

      {demoEnabled ? (
        <Demo />
      ) : (
        <p>The live demo is disabled on this deployment.</p>
      )}

      <h2 id="how">How it works</h2>
      <ol>
        <li>
          Your app presigns a short-lived URL for the document and wraps it in an HMAC-signed{" "}
          <code>capability token</code> - source URL, watermark text, permissions, and an expiry.
        </li>
        <li>
          Your app frames <code>/embed#t=&lt;token&gt;</code>. The token rides in the URL{" "}
          <em>fragment</em>, so it never reaches a server log or a Referer header.
        </li>
        <li>
          Vellum verifies the signature, fetches the document <em>server-side</em> through its proxy
          (the real URL never reaches the browser), and renders pages to <code>&lt;canvas&gt;</code>{" "}
          with pdf.js.
        </li>
        <li>
          Every page is stamped with a watermark baked into the pixels. Download, print, right-click,
          and <code>Ctrl/Cmd+S</code> are disabled unless the token grants them.
        </li>
      </ol>

      <h2>Why it&rsquo;s &ldquo;zero-knowledge&rdquo;</h2>
      <p>
        Vellum holds no database and no storage credentials. It can&rsquo;t enumerate your documents
        or your users. It serves exactly one document, to one holder of one signed token, for a few
        minutes - and nothing else. Rotating the shared secret instantly invalidates every
        outstanding link.
      </p>

      <h2>What it is (and isn&rsquo;t)</h2>
      <p>
        No browser viewer can make bytes truly un-extractable - if a page renders, the pixels exist.
        Vellum raises the bar to the industry-standard &ldquo;good enough&rdquo;: no raw file URL is
        ever exposed, links expire, and every page carries a personalized watermark that makes leaked
        screenshots traceable. It deters casual copying and makes redistribution accountable.
      </p>

      <h2>Integrate</h2>
      <p>
        Share the <code>VELLUM_TOKEN_SECRET</code> between your app and the service, mint a token with
        the same <code>lib/token.ts</code>, and frame the viewer. See the{" "}
        <a href="https://github.com/DanielWLiu07/vellum" style={{ color: "var(--accent)" }}>
          README
        </a>{" "}
        for the full handshake.
      </p>
    </main>
  );
}
