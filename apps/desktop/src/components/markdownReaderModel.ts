/**
 * Pure helpers of the read mode (Nachbesserung 2026-07-04): resolving the
 * standard relative/bundle-absolute markdown links that generated index.md
 * listings use, and hiding HTML comments AST-side (react-markdown v10 renders
 * raw HTML as literal text; Obsidian's reading view hides comments too, and
 * the managed-index marker must stay invisible).
 */

/**
 * `resolveRelativeTarget` and its `RelativeTarget` moved to `@plainva/ui`
 * (issue #61): the editor needed the same resolution, and a second copy is how
 * one of them ends up wrong. Re-exported here so the read view and its tests
 * keep their import path — an unchanged read view is the proof that lifting the
 * function changed no behaviour.
 */
export { resolveRelativeTarget, type RelativeTarget } from "@plainva/ui";

/**
 * Percent-encodes a wiki target for use inside a generated markdown link
 * destination (`[x](wiki://…)`). encodeURIComponent leaves `( ) ! ' *` raw —
 * an unbalanced `(` in a note name (or nesting depth ≥ 2) makes the CommonMark
 * destination swallow the link's closing paren, so the whole link renders as
 * literal text in read mode. decodeURIComponent reverses all of these.
 */
export function encodeWikiTarget(target: string): string {
  return encodeURIComponent(target).replace(/[()!'*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/** True if `s` is nothing but HTML comments and whitespace. Linear scan (no
 * regex backtracking) so a crafted node value cannot cause catastrophic
 * matching — replaces the ReDoS-prone /^\s*(?:<!--[\s\S]*?-->\s*)+$/. */
export function isHtmlCommentOnly(s: string): boolean {
  const n = s.length;
  let i = 0;
  let sawComment = false;
  while (i < n) {
    while (i < n && /\s/.test(s[i])) i++; // per-char test is O(1), no backtracking
    if (i >= n) break;
    if (s.startsWith("<!--", i)) {
      const end = s.indexOf("-->", i + 4);
      if (end < 0) return false; // unterminated comment
      i = end + 3;
      sawComment = true;
    } else {
      return false; // non-comment, non-whitespace content
    }
  }
  return sawComment;
}

interface MdastNodeLike {
  type?: string;
  value?: unknown;
  children?: MdastNodeLike[];
  data?: { hName?: string };
  position?: { start: { line: number; column: number; offset: number }; end: { line: number; column: number; offset: number } };
}

/** Preserve parser positions when splitting a literal text node. */
function slicedText(node: MdastNodeLike, from: number, to: number): MdastNodeLike {
  const value = String(node.value ?? "");
  const result: MdastNodeLike = { type: "text", value: value.slice(from, to) };
  if (!node.position || node.position.end.offset - node.position.start.offset !== value.length) return result;
  const point = (at: number) => {
    const before = value.slice(0, at), lines = before.split("\n");
    return { offset: node.position!.start.offset + at, line: node.position!.start.line + lines.length - 1, column: lines.length > 1 ? lines[lines.length - 1].length + 1 : node.position!.start.column + at };
  };
  result.position = { start: point(from), end: point(to) };
  return result;
}

/** Soft breaks retain the source address on each side of the rendered break. */
export function remarkMappedBreaks() {
  return (tree: MdastNodeLike) => {
    const walk = (node: MdastNodeLike) => {
      if (!node.children) return;
      node.children = node.children.flatMap((child) => {
        if (child.type !== "text" || typeof child.value !== "string" || !child.value.includes("\n")) { walk(child); return [child]; }
        const pieces: MdastNodeLike[] = [];
        let start = 0;
        for (const match of child.value.matchAll(/\n/g)) {
          if (match.index > start) pieces.push(slicedText(child, start, match.index));
          pieces.push({ type: "break", position: slicedText(child, match.index, match.index + 1).position });
          start = match.index + 1;
        }
        if (start < child.value.length) pieces.push(slicedText(child, start, child.value.length));
        return pieces;
      });
    };
    walk(tree);
  };
}

/**
 * remark plugin: drops mdast `html` nodes that consist solely of comments.
 * Code blocks are separate `code` nodes and stay untouched.
 */
export function remarkStripHtmlComments() {
  return (tree: MdastNodeLike) => {
    const walk = (node: MdastNodeLike) => {
      if (!Array.isArray(node.children)) return;
      node.children = node.children.filter(
        (child) => !(child.type === "html" && isHtmlCommentOnly(String(child.value ?? "")))
      );
      for (const child of node.children) walk(child);
    };
    walk(tree);
  };
}

const HIGHLIGHT_RE = /==([^=\n]+?)==/g;

/**
 * remark plugin: renders `==highlight==` as a real <mark> in the reading view,
 * matching the live preview. mdast has no highlight node, so the marked span
 * becomes an `emphasis` node whose `data.hName` overrides the hast tag to
 * `mark` (mdast-util-to-hast honors hName — no raw HTML involved); the `==`
 * markers themselves disappear, so they are never shown or copied literally.
 * Only `text` nodes are touched; `inlineCode`/`code` nodes stay verbatim.
 */
export function remarkStripHighlightMarks() {
  return (tree: MdastNodeLike) => {
    const walk = (node: MdastNodeLike) => {
      if (!Array.isArray(node.children)) return;
      for (let i = 0; i < node.children.length; i++) {
        const child = node.children[i];
        if (child.type === "text" && typeof child.value === "string" && child.value.includes("==")) {
          const value = child.value;
          const parts: MdastNodeLike[] = [];
          let last = 0;
          HIGHLIGHT_RE.lastIndex = 0;
          for (let m = HIGHLIGHT_RE.exec(value); m; m = HIGHLIGHT_RE.exec(value)) {
            if (m.index > last) parts.push(slicedText(child, last, m.index));
            parts.push({ type: "emphasis", data: { hName: "mark" }, position: slicedText(child, m.index, m.index + m[0].length).position, children: [slicedText(child, m.index + 2, m.index + 2 + m[1].length)] });
            last = m.index + m[0].length;
          }
          if (parts.length > 0) {
            if (last < value.length) parts.push(slicedText(child, last, value.length));
            node.children.splice(i, 1, ...parts);
            i += parts.length - 1;
            continue;
          }
        }
        walk(child);
      }
    };
    walk(tree);
  };
}

const HTML_BR_NODE_RE = /^<br\s*\/?>$/i;

/**
 * remark plugin: renders literal `<br>` tags as hard line breaks. Without
 * rehype-raw, react-markdown shows raw HTML as literal text — but `<br>` is
 * the only way to break a line inside a GFM table cell, so it must work.
 * Code blocks/spans are separate node types and stay untouched.
 */
export function remarkBrToBreak() {
  return (tree: MdastNodeLike) => {
    const walk = (node: MdastNodeLike) => {
      if (!Array.isArray(node.children)) return;
      for (const child of node.children) {
        if (child.type === "html" && HTML_BR_NODE_RE.test(String(child.value ?? "").trim())) {
          child.type = "break";
          delete child.value;
        }
        walk(child);
      }
    };
    walk(tree);
  };
}
