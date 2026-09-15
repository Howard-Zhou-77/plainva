import { describe, expect, it } from "vitest";
import { analyzeNoteSource, noteSlugger, prepareReaderSource, selectNoteFragment } from "../src/noteSource.js";
import { mintAnchorMarkerId, openAnchorMarker, closeAnchorMarker } from "../src/workspace/commentAnchor.js";

describe("one original source for anchors and transclusion", () => {
  it("ends a section at its next peer, retaining deeper headings, CRLF and Unicode", () => {
    const text = "---\r\ntitle: 🦊\r\n---\r\n# Start\r\n## Über\r\nÄ 😀\r\n### Detail\r\nBody\r\n## Next\r\nOther";
    const selected = selectNoteFragment(text, "#Über");
    expect(selected).toMatchObject({ status: "found", kind: "heading", range: { line: 5 } });
    if (selected.status === "found") expect(selected.text).toBe("## Über\r\nÄ 😀\r\n### Detail\r\nBody\r\n");
  });

  it("resolves whole paragraphs, list items and a table with a standalone id", () => {
    const text = "First line\nsoft break ^paragraph\n\n- item\n  continuation ^item\n- other\n\n| A |\n| - |\n| B |\n\n^table\n";
    expect(selectNoteFragment(text, "^paragraph")).toMatchObject({ text: "First line\nsoft break ^paragraph", range: { line: 1 } });
    expect(selectNoteFragment(text, "^item")).toMatchObject({ text: "- item\n  continuation ^item", range: { line: 4 } });
    expect(selectNoteFragment(text, "^table")).toMatchObject({ text: "| A |\n| - |\n| B |" });
  });

  it("ignores code ids/headings and respects fence character and length", () => {
    const text = "````md\n# No\ntext ^no\n```\n# Still no\n````\n\n   ~~~\n# No either\n   ~~~\n\n# Yes\n\n`hidden ^inline`";
    expect(analyzeNoteSource(text).headings.map((h) => h.text)).toEqual(["Yes"]);
    expect(selectNoteFragment(text, "^no")).toEqual({ status: "missing" });
    expect(selectNoteFragment(text, "^inline")).toEqual({ status: "missing" });
  });

  it("reports duplicate targets and allows explicit slugs and heading ancestry", () => {
    const text = "# One\n## Same\na\n# Two\n## Same\nb\n\nfirst ^id\n\nsecond ^id";
    expect(selectNoteFragment(text, "#Same")).toEqual({ status: "ambiguous" });
    expect(selectNoteFragment(text, "#same-1")).toMatchObject({ status: "found", range: { line: 5 } });
    expect(selectNoteFragment(text, "#One#Same")).toMatchObject({ status: "found", range: { line: 2 } });
    expect(selectNoteFragment(text, "^id")).toEqual({ status: "ambiguous" });
    const slug = noteSlugger();
    expect([slug("a"), slug("a-1"), slug("a")]).toEqual(["a", "a-1", "a-2"]);
  });

  it("maps marked text after frontmatter, wiki aliases, CRLF and relative dates exactly", () => {
    const id = mintAnchorMarkerId("");
    const raw = `---\r\ntitle: x\r\n---\r\n[[Long Target|Über 😀]] @2026-09-14\r\n${openAnchorMarker(id)}Exact 😀 text${closeAnchorMarker(id)}\r\n`;
    const prepared = prepareReaderSource(raw, { formatDate: () => "Today" });
    const from = raw.indexOf("Exact"), to = from + "Exact 😀 text".length;
    expect(prepared.text.slice(prepared.toRendered(from), prepared.toRendered(to, "end"))).toBe("Exact 😀 text");
    expect(prepared.toOriginal(prepared.toRendered(from))).toBe(from);
    const alias = raw.indexOf("Über");
    expect(prepared.text.slice(prepared.toRendered(alias), prepared.toRendered(alias + "Über 😀".length, "end"))).toBe("Über 😀");
    expect(prepared.text).not.toContain("title:");
    expect(prepared.text).not.toContain("\r");
  });

  it("does not rewrite wiki syntax or dates in code, destinations and escaped prose", () => {
    const raw = "`[[code]] @2026-09-14`\n\n```\n![[literal]]\n```\n\n\\[[escaped]] [label](https://example.test/@2026-09-14)\n\n![[real#Heading]]";
    const result = prepareReaderSource(raw, { formatDate: () => "Today" }).text;
    expect(result).toContain("`[[code]] @2026-09-14`");
    expect(result).toContain("![[literal]]");
    expect(result).toContain("\\[[escaped]]");
    expect(result).toContain("https://example.test/@2026-09-14");
    expect(result).toContain("wiki-embed://real%23Heading");
  });
});
