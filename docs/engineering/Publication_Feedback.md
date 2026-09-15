# Publication feedback and source-note review

Status: implemented locally, 2026-09-15. The encrypted workspace protocol remains experimental.

## Rights and transport

New publications grant `comment.read`, `content.read` and `history.read` to readers. Comment access additionally grants `comment.create`; suggestion access also grants `comment.suggest`. Suggestion access no longer grants `content.create`. It never grants writing, renaming or deleting the original note.

The shared workspace store checks the right before queueing. The queued writer checks again before sealing, and the receiving worker checks the proposal body against the operation's accepted policy. Both shells offer suggestion mode only with the returned suggestion capability. Ordinary Commenter/Editor/Admin/Owner assignments from older signed policies retain their existing proposal right; the former publication grant `Reader + comment.create + content.create` also retains it. Existing signed policies are not rewritten. New policies contain a capability older clients may not understand; update participating clients together. Existing broad grants are not silently revoked.

Recipient comments use `WorkspaceCommentStore` and `publishQueuedWorkspaceComment`, the same durable outbox as ordinary workspace comments. The recipient set comes from all groups that can read the object, including the publication owner's group. The production writer already used this group selection; the former C27 test only sealed to the recipient group and therefore represented an older client. The new integration tests use the production writer and retain the old test as an explicit history boundary.

Removing another recipient rotates the shared recipient key but does not remove the owner's envelope from existing feedback. A pending comment created under an earlier policy can still be opened by the owner after retry. Old objects encrypted only to the removed recipient epoch are not silently rewritten or presented as recoverable. No new PVO1 encryption format is introduced.

## Review in the original vault

`PublicationFeedback` renders the same incoming cards in the desktop column and the mobile sheet. Names and provenance come from the publication. Both collectors resolve the current source path by stable object ID, including after a rename. Locked or unavailable publication keys retain the existing omission behavior.

An exact publication's proposal may be applied only if its creator had suggestion rights under a policy committed by the owner's currently trusted policy chain. The collector follows predecessor hashes, with a limit of 4096 versions. Missing history leaves the proposal readable but unavailable for one-click application. Sanitized projections are always unavailable for automatic application. The ordinary anchor resolver must still find the quoted passage in the current original; a matching projection mode is not an unchecked character offset.

`publicationReviewCommentId` derives a separate 128-bit view ID from the publication and recipient comment IDs. Replies, rounds, decision references and historical decision frontiers use the same namespace. A chosen recipient ID cannot alias a local comment or a comment in another publication. Remote signed objects remain byte-for-byte unchanged.

The owner's application or decline is recorded in the original note's authenticated comment ledger. The existing `CommentOperationService` journals the intent, confirms the original text write and then posts the decision marker. Failed saves create no success marker. Lost marker acknowledgements resume with the original ID without a second text write. The shared projection combines incoming feedback with these local decisions, preserving contradictory decisions and their explicit review workflow. This is a review in the source vault, not an outgoing reply into the independent publication workspace; the UI states where the decision is stored.

## Order-independent moderation

The workspace worker reconciles immutable moderation markers after pulling and after draining the comment outbox. A marker can arrive before its target. Its authority is rebuilt from the locally observed operation document, signature, binding and the worker's accepted historical policy; a sender flag cannot grant moderation. Derived retraction state is persisted before change notifications, and memory-store replay preserves it just as SQL already does. No schema migration or history rewrite is required.

The publication collector likewise projects retractions and decisions, including owner moderation accepted under historical policy. Moderator markers, targets and replies have the same result regardless of provider listing order.

## Verification

- `workspace-publication.test.ts`: real paired-recipient store and queued writer for read/comment/suggest, source-write denial, owner readability after another recipient's revocation, offline retry, author revocation and the old single-envelope history boundary.
- `workspace-comment-retract.test.ts`, `comment-decision-stores.test.ts`: marker before target, observed-proof checks, restarted worker, real SQLite persistence and duplicate delivery.
- `publication-feedback.test.ts`: namespace separation, immutable inputs, conflicting published decisions, exact source-write completion, failed save, lost acknowledgement and no duplicate write.
- Desktop and mobile comment-component tests cover the shared incoming cards, permitted actions, sanitized proposals and read-only viewing. Existing comment completion tests remain the regression baseline.

See [encrypted workspace protocol](Encrypted_Workspace_Protocol.md), [comments and suggestions](../user/en/Comments_and_Suggestions.md) and [security and sharing](../user/en/Security_and_Sharing.md).
