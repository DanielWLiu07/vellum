/**
 * Markdown for authored module text ("info" subsections), rendered the same way
 * for the admin writing it and the student reading it.
 *
 * Deliberately dependency-free and small: headings, bold/italic, links, ordered
 * and unordered lists, fenced + inline code, blockquotes, rules, paragraphs.
 * Anything it doesn't recognise stays literal text, so a plain-text body written
 * before Markdown existed still renders exactly as prose.
 *
 * SAFETY - the output is injected with dangerouslySetInnerHTML, so the rules
 * are: raw HTML never passes through (every text run goes through escapeHtml
 * BEFORE any tag is emitted, so a user's "<" can only ever become "&lt;"), the
 * only tags in the output are the literals in this file, and the only
 * user-derived attribute is an href gated by an https-only allowlist that
 * excludes quotes and angle brackets. No javascript:, data:, or
 * protocol-relative URLs, and no way out of the attribute.
 */

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export function escapeHtml(s: string): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ESCAPES[c]!);
}

/**
 * The href for a Markdown link, or null if it isn't one we'll link to. Only
 * absolute https - authored module text has no reason to link anywhere else,
 * and everything dangerous (javascript:, data:, //host) fails this test.
 */
export function safeUrl(href: string): string | null {
  // Runs on already-escaped text, so a quote is "&quot;" by now and can't close
  // the attribute; the character class rejects one either way.
  const url = String(href ?? "").trim();
  return /^https:\/\/[^\s"'<>`]+$/i.test(url) ? url : null;
}

/** Bold + italic, on already-escaped text with links held out. */
function emphasis(s: string): string {
  return s
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/__([^_]+)__/g, "<strong>$1</strong>")
    .replace(/(^|[^*\w])\*([^*\n]+)\*/g, "$1<em>$2</em>")
    .replace(/(^|[^_\w])_([^_\n]+)_/g, "$1<em>$2</em>");
}

/** Inline formatting for one run of text. Escapes first, then adds our tags. */
function inline(raw: string): string {
  // Code spans are literal: split them out before anything else parses them.
  return escapeHtml(raw)
    .split(/(`[^`]+`)/g)
    .map((part) =>
      part.length > 2 && part.startsWith("`") && part.endsWith("`")
        ? `<code class="md-code">${part.slice(1, -1)}</code>`
        : spans(part),
    )
    .join("");
}

function spans(s: string): string {
  // Links come out first so a URL's own underscores can't be read as italics,
  // and go back in after emphasis has run over everything else.
  const links: string[] = [];
  const held = s.replace(/\[([^\]]*)\]\(([^)\s]+)\)/g, (whole, label: string, href: string) => {
    const url = safeUrl(href);
    if (!url) return whole; // not a link we'll follow - leave the text as written
    links.push(`<a class="md-link" href="${url}" target="_blank" rel="noopener noreferrer">${emphasis(label) || url}</a>`);
    return `\u0000L${links.length - 1}\u0000`;
  });
  return emphasis(held).replace(/\u0000L(\d+)\u0000/g, (_m, i: string) => links[Number(i)]!);
}

const RE_FENCE = /^\s*```/;
const RE_HEADING = /^(#{1,6})\s+(.*)$/;
const RE_QUOTE = /^\s*>\s?(.*)$/;
const RE_UL = /^\s*[-*+]\s+(.*)$/;
const RE_OL = /^\s*\d+[.)]\s+(.*)$/;
const RE_RULE = /^\s*(-{3,}|\*{3,}|_{3,})\s*$/;

/** Markdown -> HTML. Safe to inject; see the SAFETY note above. */
export function renderMarkdown(src: string): string {
  // \u0000 is our link placeholder sentinel, so it never survives the input.
  const lines = String(src ?? "").replace(/\u0000/g, "").replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;

    if (RE_FENCE.test(line)) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !RE_FENCE.test(lines[i]!)) { code.push(lines[i]!); i++; }
      i++; // the closing fence (or the end of the text)
      out.push(`<pre class="md-pre"><code>${escapeHtml(code.join("\n"))}</code></pre>`);
      continue;
    }

    if (!line.trim()) { i++; continue; }

    if (RE_RULE.test(line)) { out.push('<hr class="md-rule">'); i++; continue; }

    const heading = line.match(RE_HEADING);
    if (heading) {
      const n = heading[1]!.length;
      out.push(`<h${n} class="md-h${n}">${inline(heading[2]!)}</h${n}>`);
      i++;
      continue;
    }

    if (RE_QUOTE.test(line)) {
      const quoted: string[] = [];
      while (i < lines.length) {
        const m = lines[i]!.match(RE_QUOTE);
        if (!m) break;
        quoted.push(inline(m[1]!));
        i++;
      }
      out.push(`<blockquote class="md-quote">${quoted.join("<br>")}</blockquote>`);
      continue;
    }

    for (const [re, tag] of [[RE_UL, "ul"], [RE_OL, "ol"]] as const) {
      if (!re.test(line)) continue;
      const items: string[] = [];
      while (i < lines.length) {
        const m = lines[i]!.match(re);
        if (!m) break;
        items.push(`<li>${inline(m[1]!)}</li>`);
        i++;
      }
      out.push(`<${tag} class="md-list">${items.join("")}</${tag}>`);
      break;
    }
    if (RE_UL.test(line) || RE_OL.test(line)) continue;

    // Paragraph: run to the next blank line or block start. A single newline is
    // a hard break, which is what the plain-text bodies this replaces expected.
    const para: string[] = [];
    while (i < lines.length) {
      const l = lines[i]!;
      if (!l.trim() || RE_FENCE.test(l) || RE_RULE.test(l) || RE_HEADING.test(l) || RE_QUOTE.test(l) || RE_UL.test(l) || RE_OL.test(l)) break;
      para.push(inline(l));
      i++;
    }
    out.push(`<p class="module-info-p">${para.join("<br>")}</p>`);
  }

  return out.join("");
}
