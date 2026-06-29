import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Vellum — content guidelines",
  description: "What you can and can't share in the Vellum resource pool.",
};

export default function GuidelinesPage() {
  return (
    <main className="dash-page">
      <nav className="dash-topnav">
        <Link href="/" className="dash-brand">Vellum</Link>
        <span className="dash-topnav-links">
          <Link href="/dashboard" className="dash-back">Dashboard</Link>
          <Link href="/upload" className="dash-back">Upload</Link>
        </span>
      </nav>

      <article className="guidelines">
        <span className="pill">Community guidelines</span>
        <h1>Content &amp; sharing guidelines</h1>
        <p className="dash-sub">
          Everything you upload joins a <strong>shared pool every member can see</strong>. Keep it
          useful, lawful, and respectful so the pool stays valuable for everyone.
        </p>

        <h2>You can share</h2>
        <ul>
          <li>Study notes and guides you wrote yourself.</li>
          <li>
            <strong>Your own notes or summaries based on a textbook</strong> — written in your own
            words. (Just not scanned pages, photos, or copied verbatim passages or figures.)
          </li>
          <li>HOSA-relevant educational material you have the right to distribute.</li>
          <li>Practice questions and summaries you created.</li>
          <li>Openly-licensed or public-domain resources (with attribution).</li>
        </ul>

        <h2>Please don&apos;t share</h2>
        <ul>
          <li>Copyrighted material you don&apos;t have permission to distribute (textbooks, paid courses).</li>
          <li>Official or secured exam content, or leaked competition materials.</li>
          <li>Anything containing other people&apos;s personal information.</li>
          <li>Offensive, misleading, or off-topic content.</li>
          <li>Non-PDF files, or files over 25&nbsp;MB.</li>
        </ul>

        <h2>How sharing works</h2>
        <ul>
          <li>Uploads appear under <strong>Resources</strong> for all members.</li>
          <li>Secure links are <strong>watermarked per viewer</strong> and <strong>expire</strong> automatically.</li>
          <li>Download, print, and copy are <strong>off by default</strong> — you choose what a link allows.</li>
          <li>The source file URL is never exposed to the browser.</li>
        </ul>

        <h2>Moderation</h2>
        <p>
          Admins can remove any resource that breaks these guidelines. Repeatedly posting
          disallowed content may cost you upload access. If you spot something that shouldn&apos;t
          be here, flag it to an admin.
        </p>

        <p className="guidelines-cta">
          <Link href="/upload" className="cta">Upload a resource</Link>
        </p>
      </article>
    </main>
  );
}
