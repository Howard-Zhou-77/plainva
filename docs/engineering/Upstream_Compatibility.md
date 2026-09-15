# Upstream compatibility

Status: 2026-09-15. These checks distinguish the app's current dependencies
from a prepared upgrade. Production remains on sqlx 0.8 and Android target 36.

## SQL plugin and sqlx 0.9

The latest stable [tauri-plugin-sql 2.4.1](https://docs.rs/crate/tauri-plugin-sql/2.4.1)
depends on sqlx 0.8. Version 3.0.0-alpha.0 is a prerelease, not the stable
upgrade prerequisite. The app's `db_batch` deliberately shares the plugin's
sqlx version.

An isolated Cargo project with exact dependencies `tauri-plugin-sql = 2.4.1`
and `sqlx = 0.9.0` resolved successfully. It contained sqlx 0.8.6 and 0.9.0,
but only **one** `libsqlite3-sys` 0.30.1. It would be incorrect to describe this
particular resolution as a duplicate native SQLite link failure.

The following two probes failed to compile as expected:

```rust
pub fn dynamic_batch_query(sql: &String) {
    let _ = sqlx::query::<sqlx::Sqlite>(sql);
}

pub fn share_plugin_pool(pool: sqlx::SqlitePool) -> tauri_plugin_sql::DbPool {
    tauri_plugin_sql::DbPool::Sqlite(pool)
}
```

The first produces E0277: sqlx 0.9 requires its `SqlSafeStr` contract for
dynamic SQL. This corresponds to the current `db_batch` call pattern. The
second produces E0308 because pools from different sqlx versions are distinct
types. It is a compatibility probe, not a claim that today's batch code takes
the plugin's pool; today's batch opens its own connection using the same sqlx
version as the plugin.

The adapted dynamic call
`sqlx::query::<sqlx::Sqlite>(sqlx::AssertSqlSafe(sql.as_str()))` compiled in the
isolated project with the incompatible pool probe disabled. That wrapper is
an assertion of an audited SQL source, not input sanitization. The future
upgrade must review the source of every dynamic statement and retain bound
parameters, ordering, rollback and missing-database tests. No production call
was wrapped speculatively. See the [sqlx 0.9 string contract](https://docs.rs/sqlx/0.9.0/sqlx/struct.AssertSqlSafe.html).

Reproduce with a disposable Cargo library outside `src-tauri`, the two pinned
dependencies above (`sqlite` enabled, sqlx default features disabled), and
`cargo check`. The negative project must fail with the two diagnostics;
checking only dependency resolution is insufficient. The prerequisite for
the production change remains a compatible **stable** plugin and a unified
sqlx dependency tree, followed by the native database tests.

## Android 17 and 16 KB pages

The installed app stack is Capacitor 8.5.1, Android Gradle plugin 8.13.0 and
Gradle 8.14.3, compiling and targeting API 36. Google's [Android 17 setup
page](https://developer.android.com/about/versions/17/setup-sdk) still contains
Preview installation instructions. An API-37 system image alone is not
evidence that the production SDK/toolchain upgrade has been completed.

The isolated `PlainvaTls` AVD uses the Android 37.1 x86_64 16 KB image.
`getprop ro.build.version.sdk` returns 37; `getconf PAGE_SIZE` returns 16384.
The current debug APK passes `zipalign -c -P 16 4`. All twelve `.so` files
(three libraries across four ABIs) have LOAD alignment 16384. The inventory
now also includes `libsurface_util_jni.so`; an older description listing only
SQLCipher and image processing was incomplete.

The native `StorageCompatibilityTest` exercises SQLCipher loading, encrypted
storage, FTS5, bound Unicode/quote-containing note text, transaction rollback,
database close/reopen and integrity. It separately loads both camera JNI
libraries. Use `-e expectedPageSize 16384` when invoking the instrumentation
runner on a 16 KB image. The test creates and removes only its own unique
cache directory; it never opens an existing vault or app index.

The run passed **seven instrumentation tests** (two storage/JNI checks and
five share-queue checks) on that 16 KB emulator. The app and its own test APK
built successfully with `:app:assembleDebug :app:assembleDebugAndroidTest
:app:testDebugUnitTest`. Unqualified Android-test tasks also select the
generated Cordova module's unrelated example tests; their Kotlin classpath
conflict is not a Plainva application build failure.

A real production-start check found a separate package integration defect:
the new Core-wide `sideEffects: false` flag changed chunk initialization.
Mobile failed while constructing `WorkspacePolicyConflictError`; Desktop
also failed before mounting. Removing only that declaration restored the
mobile production boot and all six desktop production startup cases. The
isolated SDK archive was rebuilt and passed again. No crypto or policy
semantics were changed to work around initialization order.

After installing the corrected APK, the native Android WebView rendered the
welcome screen at 426 × 952 CSS pixels with no uncaught page error. Its cold
Activity launch reported 12,125 ms; this is the Android Activity measurement,
not a time-to-interactive benchmark. The subsequent app-process snapshot was
146,213 KiB PSS / 330,048 KiB RSS / zero swap. It does not include every
separate renderer process and is not a long-duration leak or physical-phone
measurement. Existing handled schema-probe/file-not-found console messages
were not counted as uncaught startup errors.

[The measured inventory](../testing/android-compatibility-2026-09-15.json)
also records RELRO end remainders. Several are nonzero despite successful
x86_64 native loading and encrypted read/write; these values alone do not
establish an observed crash, and the x86_64 run is not an ARM64 device proof.
The current release guard continues to enforce LOAD alignment. The governing
dates and repeatable commands live in
[Android platform requirements](Android_Platform_Requirements.md).

## Linux AppImage

[tauri#15665](https://github.com/tauri-apps/tauri/issues/15665) remains open.
The published stable [tauri-bundler 2.9.4 source](https://docs.rs/crate/tauri-bundler/2.9.4/source/src/bundle/linux/appimage/linuxdeploy.rs)
still invokes linuxdeploy with the GTK plugin and an optional GStreamer
plugin; this call does not add a host-Wayland exclusion. The bundler crate
version is separate from the installed CLI version 2.11.4. The registry also
offers a 3.0.0 alpha, which is not a reason to change production.

Keep `src-tauri/src/linux_appimage.rs`: it only preloads the host Wayland
library when the AppImage actually bundles a conflicting copy, and removes
nonexistent GStreamer search paths. Ordinary deb/rpm launches are outside
that path. The existing `scripts/check-appimage.sh` inventories the actual
bundle in the release workflow. No equivalent startup on an affected Mesa
25+/Wayland Linux system was observed in this Windows run.

Removal requires both a newly built artifact with suitable library/search-path
contents and a successful startup on the affected Linux environment. An open
issue, a version number or a source-level assumption cannot replace those
two observations. No workaround was removed and no monitoring job was added.
