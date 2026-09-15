# Tasks metadata and recurrence

Updated: 2026-09-14

`packages/core/src/vault/taskMetadata.ts`, `taskScan.ts` and `taskMutation.ts` own the shared contract. Both task overviews and the shared CodeMirror live-preview checkbox call the same mutation. No vault migration runs.

## Supported source format

The reader recognizes the Obsidian Tasks emoji fields: created (➕), completed (✅), due (📅), scheduled (⏳), start (🛫), identity (🆔) and recurrence (🔁). Dates are validated four-digit civil ISO dates; identity is 1–256 ASCII letters, digits, underscores or hyphens. Inline code, escaped markers, ambiguous fields and unknown directives remain in the original line. The overview separates only unambiguous fields from the description. Duplicate IDs cannot resolve a stale task action.

The recurrence subset is `every [N] day/week/month/year[s] [when done]`, case-insensitive English, N=1–999. Reference precedence is due, scheduled, start, then completion day. One period advances even when still overdue; `when done` changes the anchor to completion. Date offsets remain relative to the reference, months/years clamp to their final day, and no invalid or out-of-range date is generated. Undated tasks remain undated. Dependencies, block IDs, indented continuations (also across blank lines), ambiguous dates/IDs, unsupported rules, native `plainva.repeat` and provider ownership disable this generator.

These boundaries are narrower than [Tasks' recurrence syntax](https://publish.obsidian.md/tasks/Getting+Started/Recurring+Tasks). They do not claim a full Tasks plugin implementation. The [upstream Tasks documentation](https://github.com/obsidian-tasks-group/obsidian-tasks/tree/main/docs) supplied the format and behavior references; no upstream implementation was copied.

## One Markdown edit

`setChecklistTaskDone` changes the checkbox and metadata and inserts any successor in one string edit. Plain checkboxes receive no metadata. An existing source ID stays unchanged; a missing recurrence ID is allocated once. The successor ID is `pv-` plus the first 32 hexadecimal characters of SHA-256 over `tasks-successor-v1:<source-id>`. It is an identity link, not a date or description match. A local recheck preserves an existing successor, including edits. Editor Undo reverses the whole change. CRLF and unrelated source content are retained.

The live-preview input uses the normal click action, including keyboard Space, and applies the smallest CodeMirror change with an `input.task` user event. Both task lists re-read and resolve an explicit ID before writing. Without an ID, ordinal and original text must still match.

## Native database recurrence

`packages/ui/src/lib/taskRecurrence.ts` retains Plainva's existing catch-up semantics: the next date is after completion, rather than reproducing missed tasks. Day/week catch-up uses civil-day arithmetic; month/year catch-up preserves sequential clamping, bounded by four-digit years. The two shells serialize completion actions per adapter/path through `withTaskCompletion`.

Before creating a sibling note, the helper persists and reads back `plainva.repeatNext`: version, random operation ID, exact destination, expected SHA-256 and completion day. The successor carries `plainva.repeatOrigin`; it does not inherit the predecessor's destination receipt or dependency list. A confirmed copy is followed by a persisted `complete: true` receipt. Rechecking, a retry on another day, or deleting an already confirmed successor does not allocate another one.

A pending destination already bearing the correct origin is preserved even if edited. An occupied unrelated destination, changed pending source hash or unconfirmed write fails closed. The completion remains saved and the UI tells the user that the next task is unconfirmed. Reopening and checking again can retry a pending operation. A changed source requires inspection/manual continuation. A completed receipt survives later deletion of the successor.

This is not a distributed transaction or a cross-device compare-and-swap guarantee. The adapter's own safe write path and conflict behavior still apply; two independent devices must reconcile their ordinary Markdown changes. A crash between completing the source and saving the first destination plan may require rechecking. No automatic rollback deletes user edits.

## Verification

Core tests cover source preservation, ID resolution, Unicode, unknown rules, malformed/duplicate fields, nested content, date arithmetic and undo/recheck. Desktop and mobile completion tests cover concurrent local callers, failed writes, pending-copy recovery on another day, edited/deleted successors, source conflicts and reminder errors. `apps/desktop/e2e/tasks.spec.ts` exercises the task overview; `editor-stability.spec.ts` checks keyboard/mouse completion and one-step undo in the real shared editor with an isolated filesystem fixture.
