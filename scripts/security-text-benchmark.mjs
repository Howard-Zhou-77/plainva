// Bounded processes make a regression abortable; timings remain evidence, not
// fragile assertions tied to a particular developer machine's speed.
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
const root = new URL("../", import.meta.url);
const require = createRequire(new URL("packages/core/package.json", root));
const report = [];
for (const scenario of ["paths", "angles", "images", "links", "templates", "code", "markers", "block", "diagnostic", "subject", "cards", "outline", "html"]) {
  const result = spawnSync(process.execPath, [require.resolve("tsx/cli"), "--tsconfig", fileURLToPath(new URL("apps/desktop/tsconfig.json", root)), fileURLToPath(new URL("scripts/security-text-probe.ts", root)), scenario], { encoding: "utf8", timeout: 30_000, windowsHide: true });
  if (result.error || result.status !== 0) throw new Error(`${scenario}: ${result.error?.message ?? result.stderr}`);
  report.push(JSON.parse(result.stdout.trim()));
}
console.log(JSON.stringify({ node: process.version, results: report }, null, 2));
