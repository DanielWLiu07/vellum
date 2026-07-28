// Authored-Markdown renderer. The output is injected with
// dangerouslySetInnerHTML, so the escaping and link rules are the point here -
// a module body must never be able to introduce HTML or a non-https link.

import { describe, expect, it } from "vitest";

import { escapeHtml, renderMarkdown, safeUrl } from "./markdown";

describe("block rendering", () => {
  it("renders headings at their level", () => {
    expect(renderMarkdown("# Scene safety")).toBe('<h1 class="md-h1">Scene safety</h1>');
    expect(renderMarkdown("### Vitals")).toBe('<h3 class="md-h3">Vitals</h3>');
    // Six hashes max; a seventh is just text.
    expect(renderMarkdown("####### nope")).toBe('<p class="module-info-p">####### nope</p>');
  });

  it("renders unordered and ordered lists", () => {
    expect(renderMarkdown("- pulse\n- resps\n- BP")).toBe(
      '<ul class="md-list"><li>pulse</li><li>resps</li><li>BP</li></ul>',
    );
    expect(renderMarkdown("1. scene\n2. primary\n3. history")).toBe(
      '<ol class="md-list"><li>scene</li><li>primary</li><li>history</li></ol>',
    );
  });

  it("renders blockquotes, rules, and fenced code", () => {
    expect(renderMarkdown("> Stay calm.")).toBe('<blockquote class="md-quote">Stay calm.</blockquote>');
    expect(renderMarkdown("---")).toBe('<hr class="md-rule">');
    expect(renderMarkdown("```\nrate = 100\n```")).toBe('<pre class="md-pre"><code>rate = 100</code></pre>');
  });

  it("keeps blank-line-separated blocks as separate paragraphs, single newlines as breaks", () => {
    expect(renderMarkdown("one\ntwo\n\nthree")).toBe(
      '<p class="module-info-p">one<br>two</p><p class="module-info-p">three</p>',
    );
  });

  it("renders a plain-text body as plain prose (markdown is a no-op on it)", () => {
    const body = "Check the scene before you approach.\nAsk the patient for consent.";
    expect(renderMarkdown(body)).toBe(
      '<p class="module-info-p">Check the scene before you approach.<br>Ask the patient for consent.</p>',
    );
  });

  it("returns nothing for empty or whitespace-only input", () => {
    expect(renderMarkdown("")).toBe("");
    expect(renderMarkdown("   \n\n  ")).toBe("");
  });
});

describe("inline rendering", () => {
  it("renders bold and italic", () => {
    expect(renderMarkdown("**never** enter an _unsafe_ scene")).toBe(
      '<p class="module-info-p"><strong>never</strong> enter an <em>unsafe</em> scene</p>',
    );
    expect(renderMarkdown("__also bold__ and *also italic*")).toBe(
      '<p class="module-info-p"><strong>also bold</strong> and <em>also italic</em></p>',
    );
  });

  it("renders inline code literally, without parsing markdown inside it", () => {
    expect(renderMarkdown("use `**not bold**` here")).toBe(
      '<p class="module-info-p">use <code class="md-code">**not bold**</code> here</p>',
    );
  });
});

describe("links", () => {
  it("renders an https link as a new-tab anchor with rel=noopener", () => {
    expect(renderMarkdown("[HOSA](https://hosa.org/guide)")).toBe(
      '<p class="module-info-p"><a class="md-link" href="https://hosa.org/guide" target="_blank" rel="noopener noreferrer">HOSA</a></p>',
    );
  });

  it("does not let a URL's underscores be read as italics", () => {
    const html = renderMarkdown("[deck](https://example.org/a_b_c)");
    expect(html).toContain('href="https://example.org/a_b_c"');
    expect(html).not.toContain("<em>");
  });

  it("rejects javascript:, data:, http:, and protocol-relative links", () => {
    for (const bad of [
      "javascript:alert(1)",
      "JavaScript:alert(1)",
      "data:text/html;base64,PHNjcmlwdD4=",
      "http://insecure.example.com",
      "//evil.example.com",
      "/dashboard",
    ]) {
      const html = renderMarkdown(`[click](${bad})`);
      expect(html).not.toContain("<a ");
      expect(html).not.toContain("href");
    }
  });

  it("leaves a rejected link as its literal text", () => {
    expect(renderMarkdown("[click](javascript:alert(1)")).toContain("[click](javascript:alert(1)");
  });

  it("escapes the query separator in an accepted url", () => {
    expect(renderMarkdown("[x](https://a.test/?a=1&b=2)")).toContain('href="https://a.test/?a=1&amp;b=2"');
  });
});

describe("raw HTML never passes through", () => {
  it("escapes tags in a paragraph", () => {
    const html = renderMarkdown('<script>alert("xss")</script>');
    expect(html).not.toContain("<script");
    expect(html).toBe('<p class="module-info-p">&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;</p>');
  });

  it("escapes tags inside headings, lists, quotes, and code blocks", () => {
    expect(renderMarkdown("# <img src=x onerror=alert(1)>")).not.toContain("<img");
    expect(renderMarkdown("- <b>bold</b>")).not.toContain("<b>");
    expect(renderMarkdown("> <iframe src=x>")).not.toContain("<iframe");
    expect(renderMarkdown("```\n<script>x</script>\n```")).not.toContain("<script>");
  });

  it("escapes an attempt to break out of a link label", () => {
    const html = renderMarkdown('[a"onmouseover="alert(1)](https://ok.test/)');
    expect(html).not.toContain('onmouseover="');
    expect(html).toContain("&quot;");
  });

  it("cannot be tricked by an entity that decodes to a tag", () => {
    expect(renderMarkdown("&lt;script&gt;")).toBe('<p class="module-info-p">&amp;lt;script&amp;gt;</p>');
  });
});

describe("escapeHtml / safeUrl", () => {
  it("escapes the five HTML-significant characters", () => {
    expect(escapeHtml(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&#39;");
  });

  it("accepts only absolute https urls", () => {
    expect(safeUrl("https://a.test/x")).toBe("https://a.test/x");
    expect(safeUrl("  https://a.test/x  ")).toBe("https://a.test/x");
    expect(safeUrl("http://a.test")).toBeNull();
    expect(safeUrl("javascript:alert(1)")).toBeNull();
    expect(safeUrl("")).toBeNull();
    // No whitespace, quotes, or angle brackets can ride along into the attribute.
    expect(safeUrl('https://a.test/" onload="x')).toBeNull();
    expect(safeUrl("https://a.test/<x>")).toBeNull();
  });
});
