import { normalizeRollup, type RollupSpec } from "./rollup.js";

export type ObsidianRollupIssue = "operation" | "relation" | "property";
export type ObsidianRollupFormula =
  | { formula: string; issue?: never }
  | { formula?: never; issue: ObsidianRollupIssue };

/**
 * Measured subset, not an Obsidian expression evaluator. Keep this conservative:
 * Obsidian number/date coercion and backlinks differ from Plainva's rollups.
 * See docs/engineering/Obsidian_Rollup_Export.md for the actual comparison.
 */
export function obsidianRollupFormula(
  spec: RollupSpec,
  through: { reverseOf?: unknown; rollup?: unknown } = {},
): ObsidianRollupFormula {
  if (!normalizeRollup(spec)) return { issue: "operation" };
  if (through.reverseOf || through.rollup || /^(file|formula)\./.test(spec.through)) return { issue: "relation" };
  if (spec.of && /^(file|formula)\./.test(spec.of)) return { issue: "property" };
  const relation = `note[${JSON.stringify(spec.through)}]`;
  // Missing/null relations must be guarded before list(): Obsidian otherwise
  // propagates null instead of returning an empty list. Match the indexer's
  // markdown-only link corpus and retain duplicate references, like Plainva.
  const files = `if(${relation} == null, [], list(${relation})).filter(value.isType("link")).map(value.asFile()).filter(value != null && value.ext.lower() == "md")`;
  const values = `${files}.map(value.properties[${JSON.stringify(spec.of ?? "")}])`;
  const empty = 'if(value.isType("list"), value.length == 0, value == null || value.toString().trim() == "")';
  const checked = '(value.toString().trim().lower() == "true" || value.toString().trim().lower() == "yes")';
  switch (spec.fn) {
    case "count": return { formula: `${files}.length` };
    case "empty": return { formula: `${values}.filter(${empty}).length` };
    case "filled": return { formula: `${values}.filter(!${empty}).length` };
    case "checked": return { formula: `${values}.filter(${checked}).length` };
    case "unchecked": return { formula: `${values}.filter(!${checked}).length` };
    default: return { issue: "operation" };
  }
}
