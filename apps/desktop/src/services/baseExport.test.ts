import { describe, expect, it } from "vitest";
import * as yaml from "yaml";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { baseExportColumns, exportBaseFormulas, exportBaseValues, parseBaseConfig, planBaseFormulaExport, serializeBaseConfig } from "@plainva/ui";
import { obsidianRollupFormula, ROLLUP_FNS, VaultIndexer, VaultQueryService } from "@plainva/core";
import { LocalVaultAdapter } from "../../../../packages/core/src/vault/LocalVaultAdapter";
import { realSqlite } from "../../../../packages/core/test/helpers/realSqlite";
import { obsidianRollupFixture, OBSIDIAN_ROLLUP_FUNCTIONS } from "../../../../packages/core/test/fixtures/obsidianRollups";

describe("database export", () => {
  it("reopens the exported ten real SQLite result rows without changing membership or calculations", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "plainva-base-export-"));
    const db = await realSqlite();
    try {
      const { files, config } = obsidianRollupFixture(10);
      files.set("PlainvaRollupBenchmark/Values/LiteralNull.md", '---\nvalue: "null"\n---\n');
      for (const [relative, text] of files) {
        const target = path.join(root, relative);
        await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, text);
      }
      const vault = new LocalVaultAdapter(root); await vault.initialize();
      await new VaultIndexer(vault, db).indexVaultFull();
      const query = new VaultQueryService(db as never);
      const before = await query.queryDatabaseFiles(config);
      expect(before).toHaveLength(10);
      expect(before.find(row => row["file.path"].endsWith("Project0002.md"))?.empty).toBe(4);
      expect(before.find(row => row["file.path"].endsWith("Project0008.md"))?.count).toBe(1);
      expect(await query.getFileProperties("PlainvaRollupBenchmark/Values/V0.md")).toEqual({ value: null });
      expect(await query.getFileProperties("PlainvaRollupBenchmark/Values/V1.md")).toEqual({ value: "" });
      expect(await query.getFileProperties("PlainvaRollupBenchmark/Values/LiteralNull.md")).toEqual({ value: "null" });
      const propertyRows = await query.queryDatabaseFiles({filters:{and:['file.folder == "PlainvaRollupBenchmark/Values"']}});
      expect(propertyRows.find(row => row["file.path"].endsWith("/V0.md"))?.value).toBeNull();
      expect(propertyRows.find(row => row["file.path"].endsWith("/V1.md"))?.value).toBe("");
      const text = exportBaseFormulas(config, baseExportColumns(config, 0), before).text;
      const imported = parseBaseConfig(text);
      const after = await query.queryDatabaseFiles(imported);
      expect(after).toHaveLength(10);
      const byPath = new Map(after.map(row => [row["file.path"], row]));
      for (const row of before) for (const [key, column] of Object.entries<any>(imported.columns)) {
        expect(byPath.get(row["file.path"])?.[key]).toBe(row[column.rollup.fn]);
      }
      expect(parseBaseConfig(serializeBaseConfig(imported))._obsidian.formulas).toEqual(imported._obsidian.formulas);
      expect((await query.queryDatabaseFiles(parseBaseConfig(exportBaseFormulas(config, baseExportColumns(config, 0), []).text)))).toEqual([]);
    } finally { await db.close(); await fs.rm(root, { recursive: true, force: true }); }
  });

  it("blocks unproven arithmetic, dates, reverse relations, aliases and virtual file properties", () => {
    for (const fn of ROLLUP_FNS) {
      const result = obsidianRollupFormula({ through: "links", of: "value", fn, where: { op: "==", value: "yes" } });
      expect(!!result.formula).toBe(OBSIDIAN_ROLLUP_FUNCTIONS.includes(fn));
    }
    for (const change of [{ reverseOf: {base:"tasks.base",property:"project"} }, { rollup: { through:"x",fn:"count" } }, { previousKeys: ["oldLinks"] }]) {
      const config = { columns: { links: change, count: { rollup: {through:"links",fn:"count"} } } };
      const cols = [{ key:"count",label:"Count" }];
      expect(planBaseFormulaExport(config, cols).issues[0].issue).toBe("relation");
      expect(() => exportBaseFormulas(config, cols, [])).toThrow();
    }
    expect(planBaseFormulaExport({}, [{key:"file.tasks",label:"Tasks"}]).issues).toHaveLength(1);
  });

  it("preserves foreign formulas, quotes and colliding names without modifying the original", () => {
    const raw = 'formulas:\n  plainva_rollup_2: \'"verbatim"\'\nviews:\n  - type: table\n    name: Original\n';
    const config = parseBaseConfig(raw);
    config.columns = { 'count "quoted"': { rollup: {through:'rel"\\key',fn:"count"} } };
    config.views[0].order = ["file.name", 'count "quoted"'];
    const original = structuredClone(config);
    const output = yaml.parse(exportBaseFormulas(config, baseExportColumns(config, 0), [{"file.path":'folder/A "quote".md'}]).text);
    expect(output.formulas.plainva_rollup_2).toBe('"verbatim"');
    expect(output.formulas.plainva_rollup_2_).toContain('note["rel\\"\\\\key"]');
    expect(output.properties["formula.plainva_rollup_2_"].displayName).toBe('count "quoted"');
    expect(config).toEqual(original);
    expect(config._obsidian).toEqual(yaml.parse(raw));
    expect(() => exportBaseFormulas(config, baseExportColumns(config, 0), [{}])).toThrow("Missing database row path");
  });

  it("exports explicit values, structured lists, quotes, nulls and multiline text as inert CSV cells", () => {
    const columns = ["value", "list", "text", "null", "number"].map(key => ({key,label:key}));
    const file = exportBaseValues(columns, [{"file.path":"A.md",value:" =SUM(A1:A2)",list:["a","b"],text:'a,"b"\nc',null:null,number:-2}]);
    expect(file.text).toBe('"file.path","value","list","text","null","number"\r\n"A.md","\' =SUM(A1:A2)","[""a"",""b""]","a,""b""\nc","","-2"\r\n');
    expect(file.extension).toBe("csv");
  });
});
