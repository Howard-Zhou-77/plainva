# Large vault measurements — 2026-09-14

The directory scan now obtains regular-file metadata in the native directory
snapshot. It avoids one filesystem IPC request per file, runs blocking filesystem
work outside the native event thread, and stops a departed vault's background scan.
An incomplete listing retains previously indexed files beneath unreadable paths.
Already running database transactions finish before teardown.

## Conditions

Windows 10.0.26200, Intel i7-1265U (12 logical CPUs), 32 GiB RAM, local storage.
The fixture contains 3,000 Markdown notes, 9,000 tasks, 120 small PNG attachments
and three database views: 3,123 files in total, with 250 rows in the measured board.
All vaults are newly generated test directories. Existing user vaults are untouched.

Core measurements use Node SQLite. Native measurements use a separately identified
debug executable, Vite and a hidden WebView2 window driven through CDP. These figures
are not production-build release-gate results. A first Vite optimizer failure was
recovered before recording the completed native cold run. A two-job Rust build ran
concurrently with the core baseline; no timing adjustment was applied.

## Results

| Measurement | Result |
| --- | ---: |
| Core full index, cold | 28.42 s |
| Core full index, unchanged | 476 ms |
| Core first occurrence page / next page, 32 hits each | 53 / 39 ms |
| Core all tasks / 250-row board query | 465 / 24 ms |
| Native cold vault, complete index and sidebar | 138.30 s |
| Native search after cold indexing, 40 rendered occurrences | 1.51 s |
| Native 12 alternating large/small vault switches, index ready | 1.39–2.33 s |
| Same switches, including completed search | 1.98–2.71 s |

The repeated switch test alternates the large fixture with a one-note vault and
checks actual search results (32 and one respectively). Before the fix, a measured
large-to-small switch took 115.91 seconds, including 69.04 seconds in schema setup:
native calls were waiting behind the old vault's many filesystem requests. The
JavaScript profile was mostly idle. This is a measured contention fix, not evidence
that SQLite schema creation itself became 50 times faster.

A previous native cold run returned zero search results and is excluded as an
invalid search measurement. Its 180-second startup is not used as a controlled
before/after performance claim.

## Memory and remaining limits

Across 12 core reopens with explicit GC, heap usage was 21.2 to 20.2 MB and RSS
254–256 MB. For the native process tree, repeated switches ranged from 830 to
885 MiB working set and 555 to 611 MiB private memory; the final sample was
873 / 596 MiB. The cold run peaked at 909 / 670 MiB. Samples include the WebView
processes and are not directly comparable with the Node-only RSS.

The repeated run did not show unbounded growth. It does not establish absence of
all leaks, and it does not meet the historical 200 MB idle or 60-second full-index
budgets. Production builds, visible-window rendering and a wider hardware sample
remain necessary for those gates. Cold native indexing and SQL/IPC overhead remain
the largest measured costs.

## Reproduce

Run from `packages/core` with a Node version supporting `node:sqlite`:

```sh
node --expose-gc --import tsx scripts/benchmark-large-vault.ts --directory /new/test/root --json /output/large-vault.json
```

The generator refuses an existing target directory. The output records fixture
counts, individual timings and all 12 reopen memory samples. For native comparison,
open that generated vault in a separate debug profile, wait for complete indexing,
search for the fixture term, then alternate it with a fresh one-note vault 12 times.
Wait for the expected result set before measuring the next switch. Use a second
fresh path and index for a cold run; reopening an existing index is a warm run.

Automated regression coverage checks batched metadata, aborting directory walks,
retention beneath unreadable subtrees, draining active indexing, bounded search
pages and navigation to an occurrence in both shells.
