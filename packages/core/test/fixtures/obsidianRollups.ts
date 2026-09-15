import { stringify } from "yaml";
import type { RollupFn } from "../../src/vault/rollup.js";

export const OBSIDIAN_ROLLUP_FUNCTIONS: RollupFn[] = ["count", "empty", "filled", "checked", "unchecked"];
export const OBSIDIAN_BENCHMARK_FOLDER = "PlainvaRollupBenchmark";

/** Synthetic, copyable .base cases; no user vault material. */
export function obsidianRollupFixture(count: number) {
  const folder = `${OBSIDIAN_BENCHMARK_FOLDER}/${count}`;
  const samples = `${OBSIDIAN_BENCHMARK_FOLDER}/Values`;
  const files = new Map<string, string>();
  const values = [null, "", "   ", [], true, false, " YES ", "false", 0, 1, -3, 0.1, 0.2, "2,5", "invalid", [1, 2],
    [true, false], ["yes"], ["a", "b"], { x: 1 }, "2026-09-15", "2026-01-01T00:00:00Z", [null], [""], [[]]];
  const note = (data: object) => `---\n${stringify(data)}---\n\n# Sample\n`;
  values.forEach((value, i) => files.set(`${samples}/V${i}.md`, note({ value })));
  files.set(`${samples}/Case.md`, note({ VaLuE: "yes" }));
  files.set(`${samples}/Empty.md`, "# No frontmatter\n");
  files.set(`${samples}/Ignored.base`, stringify({ views: [{type:"table",name:"Ignored"}] }));
  const links = (ids: number[]) => ids.map(i => `[[${samples}/V${i}]]`);
  const cases: Record<string, unknown>[] = [
    {}, { links: null }, { links: links([0,1,2,3,4,5,6,7]) }, { links: links([8,9,10,11,12,13,14]) },
    { links: links([15,16,17,18,19,22,23,24]) }, { links: links([20,21,0,14]) },
    { links: ['[[Missing]]', 'plain', 2, null, `[[${samples}/Ignored.base]]`] },
    { links: [`[[${samples}/V4]]`, `[[${samples}/V4|Again]]`, `[[${samples}/V4#Sample]]`] },
    { LiNkS: `[[${samples}/Case]]` }, { links: `[[${samples}/Empty]]` },
  ];
  for (let i = 0; i < count; i++) files.set(`${folder}/Project${String(i).padStart(4, "0")}.md`, note(cases[i % cases.length]));
  const columns = Object.fromEntries(OBSIDIAN_ROLLUP_FUNCTIONS.map(fn => [fn, { rollup: { through: "links", ...(fn === "count" ? {} : { of: "value" }), fn } }]));
  const config = { filters: { and: [`file.folder == "${folder}"`] }, columns,
    views: [{ type: "table", name: "Comparison", order: ["file.name", ...OBSIDIAN_ROLLUP_FUNCTIONS] }] };
  return { files, config };
}
