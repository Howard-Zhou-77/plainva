# Paired personal design

Updated: 2026-09-14

`CustomThemeDesign` version 2 retains separate light/dark colour specifications and one corner radius. A legacy specification fills only its original mood. The other remains `null`: the editor can propose and preview it, but only adoption persists it. A one-mood design keeps the existing mode pinning. With both moods, Light/Dark/System selects the appropriate saved mood. Fonts and the selected bundled theme remain device settings.

## Opt-in and scope

The `personalDesign` profile field belongs to the member partition in encrypted workspaces. A plain vault uses the existing single-person profile. Desktop and mobile use the same `PersonalDesignSync` controller and explicit local source selection. Exactly one vault/member source can supply a device's global custom design. Choosing another source replaces that binding. Other vaults/members can retain their own register for round trips but cannot apply it to local appearance.

The switch defaults off on every device. Incoming registers are retained while off without publishing the local design. Enabling adopts an existing unique incoming design; if no register exists it publishes the current local design. Multiple variants require a visible choice. Disabling retains local appearance and the received register. Settings sync must also be enabled for transport. Locking a workspace cannot cause the editor to create a plain-vault binding in its place.

## Concurrent edits

Each revision carries a stable local actor, a counter and a bounded causal clock. The register retains concurrent heads. Dominated history is removed; replay and reversed arrival order are deterministic. A stale editor submits its observed baseline, while the controller merges the revision with the latest stored register. Unseen changes from another device remain concurrent. Choosing a displayed variant or editing after observing all variants creates a resolution that dominates those variants.

The core profile transport calls the shell-owned `mergeObservedValues` before writing its final decision. It joins the live value, local document, remote document and any legacy plaintext candidate. This also runs on first participation and when ordinary field LWW would choose the local value: merging only inside the importer would lose the discarded fork. The hook returns only its owned field; the other profile fields retain their previous rules. Member partition filtering runs first.

Malformed revisions, conflicting copies of one revision and exceeded limits fail closed. Bounds: 32 concurrent variants, 64 actors and 256 KiB of serialized JSON characters. These values contain only bounded identifiers, numbers and validated theme specifications. No timestamps decide which colour wins. This is profile convergence with retained local registers, not a distributed transaction or a transport CAS guarantee.

## Persistence and recovery

One queue serializes local design operations and incoming registers in the primary desktop window/mobile shell. The desktop settings editor already belongs to the primary window. The register is a monotonic join committed after the ordinary profile import journal; rolling back unrelated settings must not discard a concurrent design edit.

A pending mirror is persisted before the local appearance write. It is cleared only after that write succeeds. App startup, profile export/import and reopening the settings page retry a pending unique mirror. Conflicts keep the last local appearance until the user chooses. A failed mobile settings acknowledgement leaves the visible cache unchanged and attempts to restore the prior store value; an error stays visible in the editor. Desktop appearance broadcasts keep auxiliary windows in step without creating another profile revision.

## Verification

`personalDesignSync.test.ts` checks opt-in/out, source/member isolation, interrupted writes, stale editors, first participation, simultaneous edits, explicit resolution and stopped uploads after convergence through the real `SettingsSyncStep`. Desktop/mobile profile round-trip tests carry the field. Existing core profile tests remain in force.

`theming.spec.ts` checks migration, explicit counterpart adoption and System in the actual desktop settings. A private mobile browser probe opens normal settings at 320 px, injects a failed storage write, exercises adoption, opt-in, variant choice, opt-out and restart, and inspects German/French wrapping. No existing user vault is migrated or modified by these probes.
