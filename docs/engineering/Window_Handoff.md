# Window handoff

A tab returned to the main window retains its history, pin, current text, view,
selection and scroll position. The source stays open and stops editing/saving
while the owner records and adopts the transfer. It closes only after an accepted
receipt. Timeouts and lost replies do not imply rejection or success. Repeating
the same ID is idempotent; changed content under that ID is rejected. Cancellation
before application leaves the source in control, including a delayed first request.

The source journals its buffer before sending. The main window records a separate
transfer draft before opening the target. Existing dirty target content is not
overwritten. Transferred edits retain their original disk base, so later saves
still use ordinary merge-on-save and confirmation. Missing or renamed files fail
the handoff without closing the source. A receipt does not authorize deleting
another window's journal entry.

An unsent suggestion travels as a separate copy and is parked through the owner;
it is never saved as the note's original text. Client windows retain read-only SQL
permissions. Read-mode selections use original source offsets across Markdown
formatting, wiki aliases and CRLF, instead of locating the first repeated quote.

The in-process receipt ledger retains up to 4,096 small entries and never evicts a
possibly unacknowledged result. At most four transfers can be pending; document
payloads are limited to 16 MiB. Failure to accept another transfer retains the
source. Process-restart recovery uses the durable draft journal, not a guessed
receipt from a previous process.

Version comparison windows address the selected backup or workspace revision by
its exact identifier. If it disappears, they show an unavailable state. Line
counts refer to adopting the right side: additions return and removals leave the
current note. Empty text, binary files and counts beyond the diff cap have distinct
states. Mobile uses its full comparison screen and the same counts.

## Verification on 2026-09-14

Unit tests cover receipt loss/duplication, early cancellation, journal/target
failure, source identity, history/pin ordering, read-only-client draft delegation
and original-position selection. Native Windows/WebView2 runs in a separate debug
profile confirmed an unsaved transfer (including identical selection and 480-pixel
scroll position), bookmark propagation, exact older-snapshot selection, missing
snapshot handling, empty/large/binary comparisons, and a suggestion copy restored
after reload while its original file remained byte-identical. The native test
used direct CDP because WebView2 reported a shared-worker target without the
browser-context identifier required by Playwright. This is not a macOS test.
