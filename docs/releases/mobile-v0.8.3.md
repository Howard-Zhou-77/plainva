# Plainva Mobile 0.8.3

Keep your work in view on Android and iOS. This coordinated update includes the shared note, database, account, import and input-handling improvements since 0.8.2.

- **Keep conflict edits together.** Further saves stay in the same conflict copy during the editing session. Compare the versions with surrounding text and resolve the conflict deliberately.
- **Read with less clutter.** Reading controls hide on downward scroll by default; you can change this in Settings. Open images in a larger view and zoom. Selection bars stay in view, and iOS list editing is more stable.
- **Return to your work.** Pinboards reuse unchanged cached content. Task filters stay with each vault, search restores your position, folder bookmarks are available, and section embeds show the relevant part of another note.
- **Work with dates and data.** Open or create a daily note from date navigation. Database controls distinguish whole-note tags from a Tags property; metadata, summaries, relations and supported rollup exports have improved.
- **Keep your design.** “My theme” stores a light/dark pair with an explicitly chosen counterpart and optional personal sync through a selected vault.
- **Connect and bring content in.** Account setup and renewed sign-ins show clearer states; Google Drive uses an explicitly chosen folder. Joplin imports retain more structure, task metadata in directly opened Obsidian vaults is better supported, and the share inbox keeps incoming content ready for the right vault.
- **Android WebDAV.** Connections can use user-installed certificate authorities and provide clearer connection diagnostics.
- **Mail and publication feedback.** Bulk mail actions report confirmed and partial results. Comments, suggestions and the owner's decision remain distinct; interrupted workflows and moderation have received corrections.
- **Stronger input handling.** HTML, mail protocol values and graph data receive stricter checks. Revised text processing handles long or malformed input more efficiently. Unsupported HTML nesting is reported rather than saved as a truncated note.

Newly created vaults include an expanded tour. Existing vaults, templates and account identities remain in place. Encrypted workspaces and the native device-calendar provider remain experimental.

The APK is attached to this release. The AAB is the signed Google Play delivery artifact. This mobile GitHub release is marked as a pre-release so that it does not replace the desktop updater release.

[Desktop release](https://github.com/plainva/plainva/releases/tag/v0.8.3) · [iOS TestFlight](https://testflight.apple.com/join/ZRSEfZBn)

On iOS, the native marketing version remains 1.0; the TestFlight build number identifies the new delivery. Update all devices that work with the same vault.
