import { selectNoteFragment } from "@plainva/core";

export interface AnchorHit {
  /** 1-based original source line shared with the outline and editor. */
  line: number;
  slug: string | null;
  kind: "heading" | "block";
}

/** Navigation keeps the first literal heading; embeds require an unambiguous target. */
export function resolveAnchor(content: string, anchor: string): AnchorHit | null {
  if (!anchor.replace(/^#/, "").trim()) return null;
  const result = selectNoteFragment(content, anchor, true);
  if (result.status !== "found" || result.kind === "note") return null;
  return { line: result.range.line, slug: result.slug, kind: result.kind };
}
