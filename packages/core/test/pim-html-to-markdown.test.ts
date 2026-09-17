import { describe, it, expect } from "vitest";
import { htmlToMarkdown, htmlToPlainText, extractHtmlTitle, normalizeDescription, looksLikeHtml } from "../src/pim/htmlToMarkdown.js";
import { unified } from "unified";
import remarkParse from "remark-parse";

describe("htmlToMarkdown", () => {
  it("maps common inline tags and links to Markdown", () => {
    expect(htmlToMarkdown("<b>Hello</b> <i>world</i>")).toBe("**Hello** *world*");
    expect(htmlToMarkdown('<a href="https://x.io">site</a>')).toBe("[site](https://x.io)");
    expect(htmlToMarkdown('<a href="https://x.io">https://x.io</a>')).toBe("https://x.io");
  });

  it("turns <br>, paragraphs and list items into newlines / bullets", () => {
    expect(htmlToMarkdown("line1<br>line2")).toBe("line1\nline2");
    expect(htmlToMarkdown("<p>a</p><p>b</p>")).toBe("a\n\nb");
    expect(htmlToMarkdown("<ul><li>one</li><li>two</li></ul>")).toBe("- one\n- two");
  });

  it("decodes entities and strips unknown tags", () => {
    const markdown = htmlToMarkdown("Tom &amp; Jerry &lt;3 <span>x</span>");
    const tree = unified().use(remarkParse).parse(markdown);
    expect(tree.children).toMatchObject([{ type: "paragraph", children: [{ type: "text", value: "Tom & Jerry <3 x" }] }]);
  });

  it("keeps hostile markup out of Markdown syntax while retaining literal text", () => {
    const markdown = htmlToMarkdown('<script>alert(1)</script><style>hidden</style><!-- --!><p>&lt;img src=x onerror=alert(1)&gt; &amp;lt;script&amp;gt;</p><a href="java&#x09;script:alert(1)">unsafe</a>');
    const tree = unified().use(remarkParse).parse(markdown);
    expect(JSON.stringify(tree)).not.toContain('"type":"html"');
    expect(JSON.stringify(tree)).not.toContain('"type":"link"');
    expect(markdown).toContain("unsafe");
    expect(markdown).not.toContain("hidden");
    expect(htmlToPlainText("<p>&amp;lt;script&amp;gt;</p>").trim()).toBe("&lt;script&gt;");
  });

  it("preserves legitimate destinations and formatting without allowing attributes to escape", () => {
    expect(htmlToMarkdown('<a href="https://example.org/a(b)?x=1&amp;y=2">A [label]</a>')).toBe('[A \\[label\\]](https://example.org/a%28b%29?x=1&y=2)');
    expect(htmlToMarkdown('<img src="javascript:alert(1)" alt="unsafe"><img src="pic.png" alt="a] &lt;b&gt;">')).toBe('![a\\] \\<b\\>](pic.png)');
    expect(htmlToMarkdown('<code>`x`</code>')).toBe('`` `x` ``');
    expect(extractHtmlTitle('<h1>Tom &amp; Jerry <b>Plan</b></h1><p>Body</p>', 'Fallback')).toEqual({ title: 'Tom & Jerry Plan', body: '<p>Body</p>' });
    expect(extractHtmlTitle('<h1>Unclosed<p>Keep this', 'Fallback').body).toBe('<h1>Unclosed<p>Keep this');
  });
});

describe("normalizeDescription", () => {
  it("converts HTML but passes plain text through; empties become undefined", () => {
    expect(normalizeDescription("<p>Hi <b>there</b></p>")).toBe("Hi **there**");
    expect(normalizeDescription("Just plain text with **markdown**")).toBe("Just plain text with **markdown**");
    expect(normalizeDescription("   ")).toBeUndefined();
    expect(normalizeDescription(null)).toBeUndefined();
    expect(normalizeDescription(undefined)).toBeUndefined();
  });
});

describe("looksLikeHtml", () => {
  it("detects tags and entities, ignores markdown", () => {
    expect(looksLikeHtml("<p>x</p>")).toBe(true);
    expect(looksLikeHtml("a &amp; b")).toBe(true);
    expect(looksLikeHtml("plain **markdown** text")).toBe(false);
    expect(looksLikeHtml("a < b comparison")).toBe(false);
  });
});

describe("headings keep their level", () => {
  it("converts h1..h6 rather than flattening them to a line break", () => {
    expect(htmlToMarkdown("<h1>Plan</h1><p>Text.</p>")).toBe("# Plan\n\nText.");
    expect(htmlToMarkdown("<h3>Deeper</h3>")).toBe("### Deeper");
  });

  it("keeps inline formatting inside a heading", () => {
    expect(htmlToMarkdown("<h2>A <strong>bold</strong> heading</h2>")).toBe("## A **bold** heading");
  });
});

describe("images keep their source", () => {
  it("converts an img to a Markdown image instead of dropping it", () => {
    // The tag stripper would remove the picture without a trace, and an
    // importer that copies the file but loses the reference has lost it.
    expect(htmlToMarkdown('<p>Look: <img src="pics/a.png" alt="A photo"></p>')).toBe(
      "Look: ![A photo](pics/a.png)"
    );
    expect(htmlToMarkdown('<img src="b.png">')).toBe("![](b.png)");
  });

  it("drops an img that carries no source at all", () => {
    expect(htmlToMarkdown('<p>Text <img alt="broken"> here</p>')).toBe("Text  here");
  });
});
