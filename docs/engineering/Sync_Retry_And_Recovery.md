# Sync retry, local writes and verified recovery

The encrypted workspace worker distinguishes transient transport failures, account authentication, integrity/authorization failures and other actionable errors. Transient failures use exponential equal jitter with a five-minute ordinary ceiling. A provider's `Retry-After` survives conversion of the HTTP response to an error; its separate ceiling is one hour. Queue attempt counts belong to individual attempted writes, while `lastSyncFailure` records the last failed cycle. Stopping an aborted request does not persist a failure or consume a queue attempt.

Local edit notifications respect an active backoff or a stopped integrity check. `runNow()` and `retryFailed()` request one coordinated manual attempt. Concurrent requests never create a second active worker. Restarting a worker starts a fresh scheduling counter, without erasing the persisted diagnosis. Desktop and mobile receive the same status, retry deadline and failure kind.

## Local mutation ordering

`vault/pathMutation.ts` shares a gate between the worker and the conflict-aware adapter for the same vault state. Keys fold slash direction, Unicode normalization and case only for locking; file identity remains unchanged. Multi-path operations acquire their complete sorted key set, including ancestors, so a directory move cannot overlap a descendant write. Failed operations release their gates.

Downloads precede the gate. The ordinary worker re-reads current sync state inside it. The editor captures its comparison base before waiting behind an incoming write, so that write cannot retroactively become the basis of an older draft. Encrypted materialization and preparation use the workspace state as the corresponding scope. A rejected payload does not advance accepted operation heads.

## Missing signed operations

An already verified successor may trigger a bounded direct lookup of its missing predecessor at the canonical object key. This handles incomplete provider listings. A manual sync also inspects locally retained operation chains and restores byte-identical signed copies through the immutable object-store contract. Each complete local chain must match its pinned hashes, sequence, workspace, accepted policy and signatures before anything from that chain is restored. Inspection is capped at 20,000 operations per device, and direct predecessor discovery at 512 objects per pull.

No replacement operation is signed, no checkpoint is reset and no absence is treated as successful quarantine validation. A device without a complete valid copy cannot reconstruct a lost operation. Existing local files, revisions and quarantine remain available. Restoring an operation does not recreate a separately lost encrypted payload.

## Sideband traffic

Comment bundles and the device roster use a bounded cache per target/vault adapter pair, retained across step instances. WebDAV and S3 provide atomic conditional GETs. Only well-formed strong ETags are cached. Cached bytes are committed after decoding and durable processing succeed. The cache holds at most 128 entries and 8 MiB, and it never crosses target identities. Cleanup verification still performs a fresh unconditional read.

Providers without conditional reads keep their original GET path. An extra metadata request for each tiny sideband file would increase request count; there is no speculative stat-before-download optimization. Transfer counters distinguish requests, payload bytes and 304 responses. Headers, encryption and protocol checks remain part of the provider/consumer contract.

## Targeted checks

- `workspace-sync-retry.test.ts`: offline recovery, bounded scheduling, account/integrity stops, cancellation, restart and concurrent manual requests.
- `sync/local-write-interleaving.test.ts` and `workspace-personal.test.ts`: held incoming writes overlapping actual local saves; both versions remain available.
- `workspace-operation-recovery.test.ts`: exact signed restoration, incomplete/damaged copies, immutable remote conflicts and unchanged heads after payload rejection.
- `sideband-read-cache.test.ts`, `comments-files.test.ts`, `comment-recovery.test.ts`: unchanged/changed/unreliable validators, failed processing, fallback traffic and retained foreign sources.
- Mobile `profileConvergence.test.ts`: 60 idle cycles with device switching, one actual profile change, then quiet convergence.
