import { analyzeNoteSource } from "../noteSource.js";
import { stripAnchorMarkers } from "../workspace/commentAnchor.js";
import { searchTermSpecs, SNIPPET_MARK_END, SNIPPET_MARK_START } from "./ftsQuery.js";

export interface SearchOccurrence {
  from: number;
  to: number;
  line: number;
  /** The exact original spelling, used to detect a stale indexed address. */
  quote: string;
  before: string;
  after: string;
  headings: string[];
}

const fold = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** Bounded output, resumable within a note; all positions refer to original bytes. */
export function findSearchOccurrences(raw: string, query: string, options: { from?: number; limit?: number } = {}): { occurrence: SearchOccurrence; snippet: string }[] {
  const limit = Math.min(101, Math.max(1, options.limit ?? 41));
  const start = Math.max(0, options.from ?? 0);
  const terms = searchTermSpecs(query).map((term) => ({ tokens: [...fold(term.text).matchAll(/[\p{L}\p{N}]+/gu)].map((m) => m[0]), prefix: term.prefix })).filter((term) => term.tokens.length);
  if (!terms.length) return [];
  const clean = stripAnchorMarkers(raw);
  const tokens = [...clean.text.matchAll(/[\p{L}\p{N}][\p{L}\p{N}\p{M}]*/gu)].map((match) => ({ value: fold(match[0]), from: match.index, to: match.index + match[0].length }));
  const positions: { from: number; to: number }[] = [];
  for (let i = 0; i < tokens.length && positions.length < limit; i++) {
    if (clean.toRaw(tokens[i].from) < start) continue;
    for (const term of terms) {
      if (term.tokens.every((word, j) => {
        const token = tokens[i + j];
        return token && (j === term.tokens.length - 1 && term.prefix ? token.value.startsWith(word) : token.value === word);
      })) {
        const end = tokens[i + term.tokens.length - 1].to;
        positions.push({ from: tokens[i].from, to: end });
        break;
      }
    }
  }
  if (!positions.length) return [];
  const headings = analyzeNoteSource(raw).headings;
  let line = 1, previous = 0, headingIndex = 0;
  const chain: typeof headings = [];
  return positions.map((position) => {
    const from = clean.toRaw(position.from), to = clean.toRaw(position.to, "before");
    for (let i = previous; i < from; i++) if (raw[i] === "\n") line++;
    previous = from;
    while (headingIndex < headings.length && headings[headingIndex].from <= from) {
      const heading = headings[headingIndex++];
      while (chain.length && chain[chain.length - 1].level >= heading.level) chain.pop();
      chain.push(heading);
    }
    const before = clean.text.slice(Math.max(0, position.from - 60), position.from).replace(/\s+/g, " ");
    const after = clean.text.slice(position.to, position.to + 100).replace(/\s+/g, " ");
    return { occurrence: { from, to, line, quote: raw.slice(from, to), before: raw.slice(Math.max(0, from - 32), from), after: raw.slice(to, to + 32), headings: chain.map((h) => h.text) }, snippet: `${position.from > 60 ? "…" : ""}${before}${SNIPPET_MARK_START}${clean.text.slice(position.from, position.to)}${SNIPPET_MARK_END}${after}${position.to + 100 < clean.text.length ? "…" : ""}` };
  });
}
