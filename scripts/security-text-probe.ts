// Run through security-text-benchmark.mjs: each scenario has its own deadline.
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { trimChars, firstAngleValue } from "../packages/core/src/textScan.ts";
import { readTasksMetadata, setTasksField } from "../packages/core/src/vault/taskMetadata.ts";
import { htmlToMarkdown } from "../packages/core/src/pim/htmlToMarkdown.ts";
import { findImageEmbeds } from "../packages/ui/src/lib/imageTarget.ts";
import { findLinkAtOffset } from "../packages/ui/src/lib/linkParser.ts";
import { scanTemplate } from "../packages/ui/src/base/templateEngine.ts";
import { redactDiagnosticText } from "../packages/ui/src/services/diagnosticsLog.ts";
import { normalizeSubject } from "../packages/ui/src/mail/threading.ts";
import { parseNoteCard } from "../packages/ui/src/lib/noteCardModel.ts";
import { outlineContextFor } from "../packages/ui/src/lib/outline.ts";

const scenarios: Record<string, (n: number) => () => void> = {
  paths: n => { const text = "/".repeat(n) + "keep" + "/".repeat(n); return () => assert.equal(trimChars(text, "/"), "keep"); },
  angles: n => { const text = "<".repeat(n); return () => assert.equal(firstAngleValue(text), undefined); },
  images: n => { const text = "![".repeat(n); return () => assert.equal(findImageEmbeds(text).length, 0); },
  links: n => { const text = "[[".repeat(n); return () => assert.equal(findLinkAtOffset(text, text.length - 1), null); },
  templates: n => { const text = "{{prompt:".repeat(n); return () => assert.equal(scanTemplate(text).length, 0); },
  code: n => { const text = "`".repeat(n) + " 📅 2026-09-17"; return () => assert.equal(readTasksMetadata(text).due, "2026-09-17"); },
  markers: n => { const text = " 📅 2026-09-17".repeat(n); return () => assert.equal(readTasksMetadata(text).due, null); },
  block: n => { const text = "x" + " ".repeat(n) + "^block"; return () => assert.equal(setTasksField(text, "completed", "2026-09-17"), "x ✅ 2026-09-17" + " ".repeat(n) + "^block"); },
  diagnostic: n => { const text = "a".repeat(n) + "://user:synthetic-password@example.invalid"; return () => { const out = redactDiagnosticText(text); assert.ok(out.endsWith("://user:[REDACTED]@example.invalid")); assert.ok(!out.includes("synthetic-password")); }; },
  subject: n => { const text = "Re" + " ".repeat(n) + "!"; return () => assert.equal(normalizeSubject(text), "re !"); },
  cards: n => { const text = "- " + " ".repeat(n) + "word"; return () => assert.ok(parseNoteCard(text).blocks.length > 0); },
  outline: n => { const text = "- " + " ".repeat(n) + "word"; return () => assert.ok(outlineContextFor(text, 1)); },
  html: n => { const text = "<div title='x'>".repeat(4) + "&amp;".repeat(n); return () => assert.ok(htmlToMarkdown(text).length >= n); },
};
const name = process.argv[2];
if (!scenarios[name]) throw new Error("Unknown benchmark scenario");
const measurements = [];
for (const size of [4_000, 16_000, 64_000, 256_000]) {
  const run = scenarios[name](size);
  run();
  const samples = [];
  for (let i = 0; i < 3; i++) { const start = performance.now(); run(); samples.push(performance.now() - start); }
  samples.sort((a, b) => a - b);
  measurements.push({ size, milliseconds: Number(samples[1].toFixed(3)) });
}
console.log(JSON.stringify({ scenario: name, measurements }));
