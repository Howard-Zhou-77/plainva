// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { prepareReaderSource } from "@plainva/core";
import { rehypeReadAnchors, rehypeReaderSource, resolveNoteEmbed, findSourceTextRange, readSourceSelection, resolveSearchJump } from "@plainva/ui";
import { remarkMappedBreaks, remarkStripHighlightMarks } from "../components/markdownReaderModel";

describe("original source in the real Markdown renderer", () => {
  it("round-trips a selected repeated occurrence after CRLF, a wiki alias and formatting", () => {
    const raw = "---\r\ntitle: Test\r\n---\r\n[[Long Name|Alias]] **same** first\r\nsame second\r\n\r\n```md\r\nsame same\r\n```";
    const source = prepareReaderSource(raw);
    const container = document.createElement("div"); container.className = "markdown-reader";
    container.innerHTML = renderToStaticMarkup(<ReactMarkdown remarkPlugins={[remarkMappedBreaks]} rehypePlugins={[rehypeReaderSource(source, raw) as never]}>{source.text}</ReactMarkdown>);
    document.body.append(container);
    try {
      for (const from of [raw.indexOf("same"), raw.indexOf("same second"), raw.lastIndexOf("same")]) {
        const range = findSourceTextRange(container, from, from + 4, raw)!;
        const selection = document.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
        expect(readSourceSelection(container, raw)).toEqual({ anchor: from, head: from + 4 });
      }
    } finally { container.remove(); }
  });
  it("marks only the selected words after preprocessing, on both sides of a soft break", () => {
    const raw = "---\r\ntitle: x\r\n---\r\n[[Long target|Alias 😀]] @2026-09-14 before\r\nSelected 😀 ==highlight== tail ^id";
    const source = prepareReaderSource(raw, { formatDate: () => "Today" });
    const from = raw.indexOf("Selected"), to = raw.indexOf(" tail");
    const html = renderToStaticMarkup(<ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMappedBreaks, remarkStripHighlightMarks]}
      rehypePlugins={[rehypeReaderSource(source, raw) as never, rehypeReadAnchors([{ from: source.toRendered(from), to: source.toRendered(to, "end"), commentId: "selected", active: true }]) as never]}
    >{source.text}</ReactMarkdown>);
    const container = document.createElement("div");
    container.innerHTML = html;
    expect([...container.querySelectorAll("mark[data-comment-id]")].map((node) => node.textContent).join("")).toBe("Selected 😀 highlight");
    expect(container.textContent).not.toContain("^id");
    expect(container.querySelector('[data-source-line="5"]')).toBeTruthy();
  });

  it("resolves local paths before names and reports duplicate names", async () => {
    const exists = async (path: string) => path === "Project/Note.md";
    expect(await resolveNoteEmbed("Note#^block", "Project/Home.md", { exists })).toEqual({ status: "found", path: "Project/Note.md", anchor: "#^block" });
    expect(await resolveNoteEmbed("#Heading", "Home.md", { exists })).toEqual({ status: "found", path: "Home.md", anchor: "#Heading" });
    const list = async () => [{ path: "One/Same.md", isDirectory: false }, { path: "Two/Same.md", isDirectory: false }];
    expect(await resolveNoteEmbed("Same", "Home.md", { exists: async () => false, list })).toEqual({ status: "ambiguous" });
  });

  it("selects the requested occurrence across formatting and inside code", () => {
    const raw = "task first\r\n**task** second\r\n\r\n```md\r\ntask task\r\n```";
    const source = prepareReaderSource(raw);
    const container = document.createElement("div");
    container.className = "markdown-reader";
    container.innerHTML = renderToStaticMarkup(<ReactMarkdown remarkPlugins={[remarkMappedBreaks]} rehypePlugins={[rehypeReaderSource(source, raw) as never]}>{source.text}</ReactMarkdown>);
    const from = raw.indexOf("task", 1);
    const range = findSourceTextRange(container, from, from + 4, raw);
    expect(range?.toString()).toBe("task");
    expect(range?.startContainer.parentElement?.closest("strong")).toBeTruthy();
    const codeFrom = raw.lastIndexOf("task");
    const codeRange = findSourceTextRange(container, codeFrom, codeFrom + 4, raw);
    expect(codeRange?.toString()).toBe("task");
    expect(codeRange?.startOffset).toBe(5);
    expect(resolveSearchJump("prefix " + raw, { path: "Note.md", from, to: from + 4, quote: "task", before: raw.slice(0, from), after: raw.slice(from + 4, from + 36) })).toEqual({ from: from + 7, to: from + 11 });
    expect(resolveSearchJump("prefix " + raw, { path: "Note.md", from, to: from + 4, quote: "task" })).toBeNull();
    expect(resolveSearchJump("changed", { path: "Note.md", from, to: from + 4, quote: "task" })).toBeNull();
  });
});
