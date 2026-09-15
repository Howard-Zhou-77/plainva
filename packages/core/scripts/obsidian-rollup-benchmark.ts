/** Run with tsx; see the engineering report for isolated-vault setup. */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { execFileSync } from "node:child_process";
import { performance } from "node:perf_hooks";
import { LocalVaultAdapter } from "../src/vault/LocalVaultAdapter.js";
import { VaultIndexer } from "../src/vault/VaultIndexer.js";
import { VaultQueryService } from "../src/vault/VaultQueryService.js";
import { realSqlite } from "../test/helpers/realSqlite.js";
import { obsidianRollupFixture, OBSIDIAN_BENCHMARK_FOLDER, OBSIDIAN_ROLLUP_FUNCTIONS } from "../test/fixtures/obsidianRollups.js";
import { baseExportColumns, exportBaseFormulas } from "../../ui/src/base/baseExport.js";
import { parseBaseConfig } from "../../ui/src/base/baseFormat.js";

const [vaultArg, vaultId, cli, output] = process.argv.slice(2);
if (!vaultArg || !vaultId || !cli || !output) throw new Error("Usage: tsx scripts/obsidian-rollup-benchmark.ts <isolated-vault-path> <vault-id> <obsidian-cli-path> <report.json>");
const vaultPath = path.resolve(vaultArg);
const run = (...args: string[]) => execFileSync(cli, [`vault=${vaultId}`, ...args], { encoding: "utf8", timeout: 30000, maxBuffer: 8 * 1024 * 1024 }).trim();
if (path.resolve(run("vault", "info=path")) !== vaultPath) throw new Error("CLI vault does not match the explicitly selected test path");
const own = path.join(vaultPath, OBSIDIAN_BENCHMARK_FOLDER);
const marker = path.join(own, ".plainva-benchmark.json");
try {
  await fs.mkdir(own);
  await fs.writeFile(marker, JSON.stringify({ kind: "plainva-obsidian-rollup-benchmark-v1" }));
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "EEXIST" || JSON.parse(await fs.readFile(marker, "utf8")).kind !== "plainva-obsidian-rollup-benchmark-v1") throw error;
}
const sizes = [10, 100, 1000];
let filesChanged = false;
for (const size of sizes) for (const [relative, text] of obsidianRollupFixture(size).files) {
  const target = path.join(vaultPath, relative);
  if (!target.startsWith(own + path.sep)) throw new Error("Fixture escaped its own folder");
  await fs.mkdir(path.dirname(target), { recursive: true });
  if (await fs.readFile(target, "utf8").catch(() => null) !== text) {
    await fs.writeFile(target, text); filesChanged = true;
  }
}
const vault = new LocalVaultAdapter(vaultPath); await vault.initialize();
// Windows can lose the earliest child events while a new directory watcher
// attaches. Reload ONLY this explicitly verified test vault after generation.
if (filesChanged) run("reload");
const db = await realSqlite();
try {
  const indexer = new VaultIndexer(vault, db);
  const indexStart = performance.now(); await indexer.indexVaultFull();
  const indexMs = performance.now() - indexStart;
  const query = new VaultQueryService(db as never);
  const results = [];
  for (const size of sizes) {
    const { config } = obsidianRollupFixture(size);
    const coreTimes = [];
    let rows: Record<string, unknown>[] = [];
    for (let n = 0; n < 4; n++) {
      const start = performance.now(); rows = await query.queryDatabaseFiles(config);
      if (n) coreTimes.push(performance.now() - start);
    }
    if (rows.length !== size) throw new Error(`Plainva returned ${rows.length}, expected ${size}`);
    const file = exportBaseFormulas(config, baseExportColumns(config, 0), rows);
    const basePath = `${OBSIDIAN_BENCHMARK_FOLDER}/Comparison${size}.base`;
    await fs.writeFile(path.join(vaultPath, basePath), file.text);
    const imported = parseBaseConfig(file.text);
    const roundtrip: Record<string, unknown>[] = await query.queryDatabaseFiles(imported);
    if (roundtrip.length !== size) throw new Error("Reopened export changed row membership");
    const observedByPath = new Map(roundtrip.map(r => [r["file.path"], r]));
    for (const row of rows) for (const [key, column] of Object.entries<{rollup: {fn: string}}>(imported.columns)) {
      if (row[column.rollup.fn] !== observedByPath.get(row["file.path"])?.[key]) throw new Error("Plainva roundtrip changed a rollup");
    }
    let observed: Record<string, unknown>[] = [];
    const expected = new Map(rows.map(row => [row["file.path"], row]));
    const mismatch = (observed: Record<string, unknown>[]) => {
      if (observed.length !== size) return `Expected ${size} rows, found ${observed.length}`;
      for (const row of observed) for (const fn of OBSIDIAN_ROLLUP_FUNCTIONS) {
        const value = expected.get(row.path)?.[fn];
        if (String(value) !== String(row[fn])) return `${row.path} / ${fn}: Plainva ${JSON.stringify(value)} != Obsidian ${JSON.stringify(row[fn])}`;
      }
      return null;
    };
    // Obsidian's file watcher is asynchronous; these are readiness retries,
    // outside the measured query runs. Always bounded and path-specific.
    for (let n = 0; n < 40; n++) {
      try { observed = JSON.parse(run("base:query", `path=${basePath}`, "format=json")); } catch { observed = []; }
      if (!mismatch(observed)) break;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    if (mismatch(observed)) throw new Error(mismatch(observed)!);
    const cliTimes = [];
    for (let n = 0; n < 3; n++) {
      const start = performance.now(); observed = JSON.parse(run("base:query", `path=${basePath}`, "format=json"));
      cliTimes.push(performance.now() - start);
    }
    if (observed.length !== size) throw new Error(`Obsidian returned ${observed.length}, expected ${size}`);
    if (mismatch(observed)) throw new Error(mismatch(observed)!);
    results.push({ rows: size, comparisons: size * OBSIDIAN_ROLLUP_FUNCTIONS.length, coreQueryMs: coreTimes, obsidianCliMs: cliTimes, baseBytes: Buffer.byteLength(file.text), roundtripRows: roundtrip.length });
    console.log(JSON.stringify(results[results.length - 1]));
  }
  const report = { observedAt: new Date().toISOString(), obsidian: run("version"), node: process.version,
    platform: `${os.platform()} ${os.release()}`, cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length,
    ramGiB: Math.round(os.totalmem() / 1024 ** 3), indexMs, results,
    timingScope: "Warm Core query including linked-note loads vs Obsidian CLI including process/IPC/JSON. No comparative speed claim; index/file creation/watcher readiness excluded." };
  await fs.writeFile(path.resolve(output), JSON.stringify(report, null, 2) + "\n");
} finally { await db.close(); }
