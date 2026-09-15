# Obsidian rollup export

Measured on 2026-09-15 with Obsidian 1.12.7, its official CLI, and Plainva's real SQLite query service. The synthetic fixture and the exported `.base` files produced **5,550 equal rollup values** across 10, 100 and 1,000 result rows. Reopening each export in Plainva preserved both row membership and calculated values. This is a bounded compatibility result for the operations below, not an implementation of the whole Obsidian formula language.

## The supported subset

| Rollup | Formula export | Meaning and boundary |
| --- | --- | --- |
| `count` | Supported through a stored relation | Number of resolvable Markdown references; duplicate references count separately. Missing notes, attachments and non-link values do not count. |
| `empty`, `filled` | Supported through a stored relation | Count notes with/without a value. Null, missing, empty text, whitespace and an empty list are empty. A nonempty list is not empty, even when its members are empty. |
| `checked`, `unchecked` | Supported through a stored relation | Match Plainva's trimmed, case-insensitive `true`/`yes` conversion; unchecked is its complement. |
| `countWhere`, `percentWhere` | Values export | The full condition grammar has not been proven equivalent. |
| `sum`, `average`, `median`, `min`, `max` | Values export | Plainva accepts numeric strings, including a decimal comma, ignores nonnumeric values, and rounds selected results. The tested native-number candidate differed: `[0,1,-3,0.1,0.2,"2,5","invalid",null]` yielded `0.8` in Plainva and `-1.7` in that Obsidian candidate. An empty native-number reduction also returned zero where Plainva returns null. This rejects that candidate, not every possible arithmetic formula. |
| `earliest`, `latest` | Values export | The tested sort/date candidate changed `2026-01-01T00:00:00Z` to local time `2026-01-01T01:00:00` and did not preserve Plainva's string/null rules. |
| `unique` | Values export | Typed Obsidian uniqueness has not been proven equivalent to Plainva's flattened string set. |
| Reverse relations, a rollup through another rollup, alternative relation keys, virtual file-property rollups | Values export | Obsidian backlinks are not the same as incoming links from a specific frontmatter property. No silent substitution. |

The fixture includes null/missing relations, scalar and list relations, broken targets, a `.base` attachment, duplicate links with aliases/headings, differently cased property keys, numbers, text numbers, booleans, dates, objects and nested lists. Link resolution was checked with unambiguous vault-relative targets; this is not a proof that the two applications resolve every ambiguous basename identically. No third-party plugin or Obsidian program code is bundled.

The comparison exposed two Plainva query defects, corrected in the shared service: indexed YAML null was being returned as the string `"null"`, and a hidden relation key lacked the case-insensitive fallback already used for visible columns. Decoding now preserves actual null and empty strings across normal queries, `getFileProperties`, and rollup target loads. Literal text `"null"` remains text. Existing notes and index storage need no migration. The generated empty-value formula tests list cardinality before Obsidian's loose null comparison, preserving nonempty nested lists.

## Export behavior

Desktop exposes **Export table** in the database menu; mobile exposes the same action in the app bar. Both use `BaseExportDialog` and the same exporter.

The `.base` output is a result table with the current row paths as a fixed selection. Supported rollup values remain formulas and change when linked notes change. The current database's live source/filter rules and layout are not cloned. This avoids claiming equivalent filter or layout semantics and keeps scoped/filtered result membership exact. Open the exported file in the same vault as the referenced notes. A zero-row export remains empty.

An unsupported visible column disables formula export and is named with its reason. CSV requires its own explicit action and contains current calculated values, row paths and the view's columns. Lists/objects remain JSON within quoted CSV cells. Null is an empty cell. Formula-like text is prefixed with an apostrophe so spreadsheets treat it as data. CSV values do not update later.

The chooser captures the reviewed result when it opens, so a sync update cannot silently replace its rows during export. Cancellation keeps it open; write errors allow retry. Neither mode writes back to the source base or materializes calculated properties in notes. Existing foreign formulas remain untouched on read and survive the original parser/serializer roundtrip. A formula export copies existing formula definitions, avoids generated-name collisions, and retains Plainva rollup metadata so its own exported calculated columns remain usable on reopening.

## Measurement

Windows 10.0.26200, i7-1265U, 12 logical CPUs, 32 GiB RAM, Node 25.7.0. Three warm runs per size after one warm-up. Source creation, the initial 3.28 s index and Obsidian watcher readiness are excluded from query timings.

| Result rows | Compared values | Core query, ms | Obsidian CLI, ms | Export bytes |
| ---: | ---: | --- | --- | ---: |
| 10 | 50 | 4.19–6.02 | 169.99–177.09 | 3,092 |
| 100 | 500 | 6.21–7.12 | 338.22–439.16 | 8,772 |
| 1,000 | 5,000 | 24.36–27.56 | 2,122.28–2,901.87 | 66,472 |

These timings have different boundaries: Core includes SQL/property loads and aggregation; Obsidian includes process startup, IPC, query evaluation and JSON serialization. They establish costs of this harness, not a relative engine-speed claim. [Raw measurement](../testing/obsidian-rollups-2026-09-15.json).

## Reproduction and regression coverage

Use a separate test profile and vault in Obsidian, enable its CLI, and identify that vault. With Node supporting `node:sqlite` and the workspace dependencies installed, run from `packages/core`:

```text
pnpm exec tsx scripts/obsidian-rollup-benchmark.ts <isolated-vault-path> <vault-id> <obsidian-cli-path> <report.json>
```

The script first verifies that the CLI vault path matches the explicitly supplied path. It generates only `PlainvaRollupBenchmark/`, requires its ownership marker before reusing that directory, and reloads the selected test vault when creating/changing fixture files. Windows can miss the first child events while attaching a watcher to a new directory; bounded readiness checks include linked-note values before timing begins. No existing vault is discovered or selected automatically.

`apps/desktop/src/services/baseExport.test.ts` covers real SQLite export/reopening, null/empty reads, hidden relation keys, unsupported operations, foreign formulas, escaping, empty results and inert CSV. `baseExportDialog.test.tsx` covers explicit format choice, snapshot consistency, cancellation and failed-write retry. `apps/desktop/e2e/base.spec.ts` exercises the actual database menu and both save paths. The actual mobile BaseScreen was checked at 320 px in German/French, including downloaded file contents, disabled formula export, completed animations and unobscured controls. These browser fixtures are not native device measurements.

Primary format/API references: [Bases syntax](https://obsidian.md/help/bases/syntax), [formula functions](https://obsidian.md/help/bases/functions), [Obsidian CLI](https://obsidian.md/help/cli). The implementation is in `packages/core/src/vault/obsidianRollup.ts` and `packages/ui/src/base/baseExport.ts`.
