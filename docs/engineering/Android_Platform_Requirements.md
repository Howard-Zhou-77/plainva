# Android platform requirements

Status: 2026-09-15. What Google Play and Android require of the mobile app,
when, and which guard in this repository backs each requirement. Re-check the
dates when a new Android version or Play policy lands; the test
`apps/mobile/src/androidPlatformGuards.test.ts` keeps the guards wired.

## The short version

There is **no new limit on app storage** in Android 17. The headlines about
"memory limits" mean RAM. The current requirements are:

| Requirement | Applies | Deadline | Plainva today | Guard |
|---|---|---|---|---|
| **Target API level.** New builds must target the previous year's Android. | Play, all apps | API 36 since **2026-08-31**; no confirmed API-37 Play deadline in the current policy | `targetSdkVersion = 36` (`apps/mobile/android/variables.gradle`) | `androidPlatformGuards.test.ts` (floor 36) |
| **16 KB page size.** Every native library must be LOAD-aligned to 16 KB. | Play, apps targeting API 35+ on 64-bit devices | Updates since 2026-05; **hard block on upload from 2027-02-01** | Three libraries across four ABIs: SQLCipher 4.17.0, image-processing JNI and surface JNI. All twelve files have LOAD alignment 16384 in the 2026-09-15 APK; native loading and storage passed on the isolated x86_64 16 KB image | Workflow step **Check 16 KB page alignment of native libraries** in `.github/workflows/release-mobile.yml`, before the Play upload |
| **Process memory limit** ("Memory Limiter"). Excess memory can cause reclaim, throttling and eventually termination. | Android 17+; limits depend on device configuration and process visibility | Platform behavior; no additional Play deadline established here | Emulator startup snapshot recorded; sustained limiter behavior is not measured | `ProcessExitPlugin` records relevant system exits in sync diagnostics |

## Per-app memory limit

AOSP's Memory Limiter uses cgroup `memory.high` / `memory.swap.max` for app
processes. Reference limits by device RAM (visible / not visible) are below;
the device's `/system/etc/memory-limiter-config.xml` determines its actual limits.

| Device RAM | Visible | Background |
|---|---|---|
| 4 GB | 2 048 MiB | 1 024 MiB |
| 6 GB | 4 096 MiB | 2 048 MiB |
| 8 GB | 5 120 MiB | 3 072 MiB |
| 12 GB | 8 192 MiB | 4 096 MiB |
| 16 GB | 10 240 MiB | 5 120 MiB |

A startup snapshot does not establish behavior over hours of sync, graph use
or repeated indexing. Two things follow:

1. **Measure** on a phone with the large test vault:
   `adb shell dumpsys meminfo com.plainva.app` at start, after a full-text
   search, after opening the graph, after 30 minutes of background sync.
   Record `TOTAL PSS` per point in the plan of record. Expect no upward drift.
2. **Know when it happened.** `ProcessExitPlugin` (Android 11+) reads
   `ActivityManager.getHistoricalProcessExitReasons` on every start;
   `services/processExits.ts` classifies the exits (the limiter names itself
   as `MemoryLimiter:AnonSwap` in the description; low memory, excessive
   resource use, crashes and ANRs are kept too) and the sync diagnostics screen
   lists them under "Ended by the system". A day without an entry is half the
   proof that the app stays inside its budget; the measurement is the other
   half.

Source: [AOSP Memory Limiter](https://source.android.com/docs/core/perf/memory-limiter).

## 16 KB page size

Native libraries compiled for 4 KB pages fail to load on 16 KB devices; Play
refuses uploads without 16 KB support from 2027-02-01. The bundle currently
carries SQLCipher for Android through `@capacitor-community/sqlite`, plus
image-processing and surface JNI through the camera stack. The 2026-09-15
APK inventory found all twelve ABI-specific files LOAD-aligned at `0x4000`. The workflow step unpacks the AAB, runs `readelf -lW` on
every `.so` and fails the job when any `LOAD` segment is aligned below
`0x4000` (16384). It runs before the Play upload, so a dependency bump that
regresses this never reaches the internal track.

Sources: developer.android.com/guide/practices/page-sizes;
Android Developers Blog "Prepare your apps for Google Play's 16 KB page size
compatibility requirement" (2025-05).

The native checks and measured limits are in [Upstream compatibility](Upstream_Compatibility.md). Run the app-specific instrumentation tasks (`:app:assembleDebugAndroidTest`), not every dependency module's example tests. The `StorageCompatibilityTest` runner accepts `-e expectedPageSize 16384` for a 16 KB device.

## Target API level

Play requires new apps and updates to target the previous year's Android
(API 36 since 2026-08-31, extension to 1 November on request). Moving to API
37 (Android 17) remains pending a confirmed stable SDK/toolchain combination;
the official setup page still uses Preview installation wording. The current
Capacitor 8.5.1 / AGP 8.13.0 / Gradle 8.14.3 stack remains on compile/target 36.
The [Play policy](https://support.google.com/googleplay/android-developer/answer/11926878)
does not yet establish a 2027-08-31 API-37 deadline. When targeting 37, apps
get a hard cap on RemoteViews/widget bitmap memory
(`1.5 × screen width × screen height × 4` bytes, fatal on overflow). Plainva has
no widget today; the cap becomes relevant the day one is added.

## Where the app stores data (for the record)

- Vault, index, drafts and journals: `Directory.Data` (app-private).
- ZIP backups and the recovery file: `Directory.Documents` (visible to the
  user; retention is by count — see the maintainer's open point C25 on the
  empty `readdir` after a reinstall).
- Share staging and exports: `Directory.Cache` (the system may clear it).
- External vault folders: Storage Access Framework tree grants, outside the
  sandbox (`VaultFolderPlugin`).

None of these is subject to a new quota in Android 17.
