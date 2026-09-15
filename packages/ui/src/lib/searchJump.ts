/**
 * Jump-to-match helpers for the sidebar search (plan Suche P5): clicking a
 * search result opens the note and reveals the first occurrence of the term.
 * Matching is case-insensitive but literal — FTS diacritic folding is wider,
 * so a fold-only match (e.g. "muller" -> "Müller") simply does not jump.
 */

/** One parked jump at a time: the editor pane may not even be MOUNTED yet
 *  when a result is clicked (lazy component, first file open), so the click
 *  stores the request here and pokes mounted editors via the
 *  `plainva-search-jump` event; whichever consumer sees the file first takes
 *  the jump (one-shot). */
/**
 * A jump names a term (the sidebar search), a line (a backlink's place since
 * the Build-91 feedback round, P7), or both — with both, the line wins in the
 * editor and the term serves the read view, which has no lines.
 */
export interface SearchJump {
  path: string;
  term?: string;
  line?: number;
  from?: number;
  to?: number;
  quote?: string;
  before?: string;
  after?: string;
}

let pendingSearchJump: SearchJump | null = null;

export function setPendingSearchJump(jump: SearchJump): void {
  pendingSearchJump = jump;
}

/** Hands the parked jump to the caller iff it targets `path`; clears it. */
export function consumePendingSearchJump(path: string | null): SearchJump | null {
  if (!path || !pendingSearchJump || pendingSearchJump.path !== path) return null;
  const jump = pendingSearchJump;
  pendingSearchJump = null;
  return jump;
}

/** First case-insensitive occurrence of `term` in `text` (editor modes). */
export function findFirstMatch(text: string, term: string): { from: number; to: number } | null {
  if (!term) return null;
  const idx = text.toLowerCase().indexOf(term.toLowerCase());
  return idx < 0 ? null : { from: idx, to: idx + term.length };
}

/** A changed note is re-anchored to the nearest exact quote, never a stale offset. */
export function resolveSearchJump(text: string, jump: SearchJump): { from: number; to: number } | null {
  if (jump.from !== undefined && jump.to !== undefined) {
    const contextScore = (at: number) => {
      let score = 0;
      const before = jump.before ?? "", after = jump.after ?? "";
      for (let i = 1; i <= before.length && text[at - i] === before[before.length - i]; i++) score++;
      for (let i = 0; i < after.length && text[at + (jump.quote?.length ?? 0) + i] === after[i]; i++) score++;
      return score;
    };
    if (jump.from >= 0 && jump.to <= text.length && (!jump.quote || text.slice(jump.from, jump.to) === jump.quote) && contextScore(jump.from) === (jump.before?.length ?? 0) + (jump.after?.length ?? 0)) return { from: jump.from, to: jump.to };
    if (jump.quote) {
      let best = -1, score = -1, distance = Infinity, tied = false;
      for (let at = text.indexOf(jump.quote); at >= 0; at = text.indexOf(jump.quote, at + 1)) {
        const candidateScore = contextScore(at), candidateDistance = Math.abs(at - jump.from);
        if (candidateScore > score || (candidateScore === score && candidateDistance < distance)) { best = at; score = candidateScore; distance = candidateDistance; tied = false; }
        else if (candidateScore === score && candidateDistance === distance) tied = true;
      }
      return best < 0 || tied ? null : { from: best, to: best + jump.quote.length };
    }
  }
  if (jump.line) {
    let from = 0;
    for (let line = 1; line < jump.line; line++) { const next = text.indexOf("\n", from); if (next < 0) break; from = next + 1; }
    const end = text.indexOf("\n", from);
    return { from, to: end < 0 ? text.length : end };
  }
  return jump.term ? findFirstMatch(text, jump.term) : null;
}

/** Locate the selected occurrence across inline formatting in this reader only. */
export function readSourceSelection(root: Element, original: string, selection = root.ownerDocument.getSelection()): { anchor: number; head: number } | null {
  const reader = root.matches(".markdown-reader") ? root : root.querySelector(".markdown-reader");
  if (!reader || !selection?.anchorNode || !selection.focusNode) return null;
  const offsetOf = (node: Node, offset: number): number | null => {
    const element = node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement;
    if (element?.closest(".markdown-reader") !== reader || element?.closest("ins[data-comment-id]")) return null;
    const span = element?.closest<HTMLElement>("[data-reader-text]");
    const code = element?.closest("code");
    const container = span ?? code;
    if (!container) return null;
    const prefix = root.ownerDocument.createRange();
    prefix.setStart(container, 0); prefix.setEnd(node, offset);
    const position = prefix.toString().length;
    if (span) {
      const changes = JSON.parse(span.dataset.sourceOffsets ?? "[]") as [number, number][];
      let part = changes[0];
      for (const next of changes) { if (next[0] > position) break; part = next; }
      return part ? part[1] + position - part[0] : Number(span.dataset.sourceFrom) + position;
    }
    const block = code!.closest<HTMLElement>("[data-source-from][data-source-to]");
    if (!block) return null;
    const a = Number(block.dataset.sourceFrom), b = Number(block.dataset.sourceTo);
    const raw = original.slice(a, b);
    const start = raw.replace(/\r\n/g, "\n").indexOf((code!.textContent ?? "").trimEnd());
    if (start < 0) return null;
    let normalized = 0, i = 0;
    for (; i < raw.length && normalized < start + position; i++, normalized++) if (raw[i] === "\r" && raw[i + 1] === "\n") i++;
    return a + i;
  };
  const anchor = offsetOf(selection.anchorNode, selection.anchorOffset), head = offsetOf(selection.focusNode, selection.focusOffset);
  return anchor === null || head === null ? null : { anchor, head };
}

/** Locate the selected occurrence across inline formatting in this reader only. */
export function findSourceTextRange(root: Element, from: number, to: number, original?: string): Range | null {
  const reader = root.matches(".markdown-reader") ? root : root.querySelector(".markdown-reader");
  if (!reader) return null;
  let first: { node: Text; offset: number } | null = null;
  let last: { node: Text; offset: number } | null = null;
  for (const span of reader.querySelectorAll<HTMLElement>("[data-reader-text]")) {
    if (span.closest(".markdown-reader") !== reader) continue;
    const a = Number(span.dataset.sourceFrom), b = Number(span.dataset.sourceTo);
    if (b <= from || a >= to) continue;
    const changes = JSON.parse(span.dataset.sourceOffsets ?? "[]") as [number, number][];
    const atRaw = (offset: number) => { let part = changes[0]; for (const next of changes) { if (next[0] > offset) break; part = next; } return part ? part[1] + offset - part[0] : a + offset; };
    const walker = span.ownerDocument.createTreeWalker(span, NodeFilter.SHOW_TEXT);
    let node: Node | null, offset = 0;
    while ((node = walker.nextNode())) {
      if (node.parentElement?.closest("ins[data-comment-id]")) continue;
      const text = node as Text;
      for (let i = 0; i < text.length; i++) {
        const rawStart = atRaw(offset + i), rawEnd = atRaw(offset + i + 1);
        if (rawEnd > from && rawStart < to) {
          first ??= { node: text, offset: i };
          last = { node: text, offset: i + 1 };
        }
      }
      offset += text.length;
    }
  }
  // Code is rendered by the syntax highlighter. Its code element contains
  // only the original text, so resolve within its addressed source block.
  if ((!first || !last) && original !== undefined) for (const code of reader.querySelectorAll("code")) {
    if (code.closest(".markdown-reader") !== reader) continue;
    const block = code.closest<HTMLElement>("[data-source-from][data-source-to]");
    const a = Number(block?.dataset.sourceFrom), b = Number(block?.dataset.sourceTo);
    if (!block || a > from || b < to) continue;
    const normalize = (text: string) => text.replace(/\r\n/g, "\n");
    const codeText = code.textContent ?? "";
    const at = normalize(original.slice(a, b)).indexOf(codeText.trimEnd());
    if (at < 0) continue;
    const start = normalize(original.slice(a, from)).length - at;
    const end = normalize(original.slice(a, to)).length - at;
    if (start < 0 || end > codeText.length) continue;
    const walker = code.ownerDocument.createTreeWalker(code, NodeFilter.SHOW_TEXT);
    let node: Node | null, offset = 0;
    while ((node = walker.nextNode())) {
      const text = node as Text;
      if (!first && offset + text.length > start) first = { node: text, offset: Math.max(0, start - offset) };
      if (first && offset <= end && offset + text.length >= end) { last = { node: text, offset: end - offset }; break; }
      offset += text.length;
    }
    if (first && last) break;
  }
  if (!first || !last) return null;
  const range = reader.ownerDocument.createRange();
  range.setStart(first.node, first.offset); range.setEnd(last.node, last.offset);
  return range;
}

/** Walks the rendered read-view DOM for the first text node containing `term`
 *  and returns a Range over the match (single text node — a term split across
 *  inline formatting is treated as not found). */
export function findTextRange(root: Node, term: string): Range | null {
  if (!term) return null;
  const needle = term.toLowerCase();
  const doc = root.ownerDocument;
  if (!doc) return null;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const text = node.textContent ?? "";
    const idx = text.toLowerCase().indexOf(needle);
    if (idx >= 0) {
      const range = doc.createRange();
      range.setStart(node, idx);
      range.setEnd(node, idx + term.length);
      return range;
    }
  }
  return null;
}

/** Applies the native selection to the range and scrolls it into view — the
 *  selection itself is the (theme-correct) highlight in the read view. */
export function selectAndRevealRange(range: Range): void {
  const win = range.startContainer.ownerDocument?.defaultView;
  const sel = win?.getSelection?.();
  if (sel) {
    sel.removeAllRanges();
    sel.addRange(range);
  }
  try {
    range.startContainer.parentElement?.scrollIntoView({ block: "center" });
  } catch {
    // jsdom has no scrollIntoView — selection alone is fine there.
  }
}
