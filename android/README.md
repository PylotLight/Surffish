# Surffish for Android

Expo (SDK 57, RN 0.86, TypeScript, Expo Router) app on **Mozilla GeckoView**, wrapped in a local
Kotlin Expo module. GeckoView over Android WebView because it runs real WebExtensions (uBlock Origin
and friends from addons.mozilla.org).

Status: 0.1.0, first testable build. Sideload only.

## Install the APK

1. Open the latest **android** workflow run for the PR (Actions tab) and download the
   `surffish-android-apk` artifact. GitHub artifacts are zips and need you to be signed in to GitHub,
   so grab it on the phone in the GitHub app / a signed-in browser, or on the Mac and `adb install`.
2. Unzip, tap `Surffish-android-0.1.0-<sha>.apk`, allow "install unknown apps" for whatever opened it.
3. Optional: Settings → Set as default browser.

arm64-v8a only (every current phone). Builds without the signing secrets use the Expo template's
debug keystore, so they install over each other but **not** over a build signed with a real key
(uninstall first if you switch).

## Build

Bun everywhere (no npm, no package-lock) except one spot: **Gradle needs a real `node`** on PATH.
The RN/Expo Gradle scripts shell out to `node --eval "require('expo/bin/autolinking')" ...` and the RN CLI,
and those break when `node` is Bun (commander argv parsing). Install, prebuild, typecheck, tests and scripts
are all Bun. CI downloads Node 22 LTS from nodejs.org just for the Gradle step. Gradle/JDK obviously stay.

```sh
cd android
bun install
bun run typecheck
bun run test
bun run apk        # expo prebuild + ./gradlew :app:assembleRelease (needs JDK 17 + Android SDK/NDK)
# APK: android/android/app/build/outputs/apk/release/app-release.apk
```

`bun run android` builds and installs a debug build on a connected device.

CI: `.github/workflows/android.yml` runs on PRs that touch `android/**` (or `src/shared/**`) and on
manual dispatch, on the k3s runner. It downloads JDK 17 + Android SDK/NDK (cached if the runner mounts
`/cache`), typechecks, prebuilds, assembles a release APK and uploads it as an artifact. No releases
or tags are created.

Release signing (optional): set repo secrets `ANDROID_KEYSTORE_BASE64`, `ANDROID_STORE_PASSWORD`,
`ANDROID_KEY_PASSWORD`, `ANDROID_KEY_ALIAS` (default alias `surffish`); `build/inject-signing.sh`
wires them in after prebuild.

## Layout

```
android/
  app/                    expo-router screens
    index.tsx             browser: GeckoView + bottom address bar, menus, prompts
    tabs.tsx              tab switcher grid (normal / private pages, thumbnails)
    bookmarks.tsx history.tsx extensions.tsx settings.tsx
    +native-intent.tsx    keeps incoming http(s)/share intents out of the router
  src/lib/
    browser.ts            tab store (useSyncExternalStore), Gecko event wiring, session restore
    db.ts                 expo-sqlite profile db (sync-ready schema, see below)
    shared.ts             re-exports pure TS from ../src/shared (navigation, autocomplete, keywords, clean links)
    suggest.ts amo.ts theme.ts sync-clock.ts
  src/components/         Toolbar (address bar + suggestions), Overlays (menu, sheets, find bar), StartPage
  modules/gecko-view/     local Expo module (Kotlin)
    GeckoEngine.kt        one GeckoRuntime, one GeckoSession per tab, all delegates -> JS events
    GeckoPrompts.kt       native dialogs: alert/confirm/prompt, <select>, date/time, file upload, auth, popups
    GeckoHostView.kt      native view; `tabId` prop swaps that tab's session into a GeckoView
    GeckoViewModule.kt    Expo module: commands, events, intents, file picker, immersive mode
  plugins/withSurffishAndroid.js   intent filters (default browser, share), Mozilla maven, androidx.core pin, arm64
  build/inject-signing.sh
```

Engine: GeckoView `153.0.20260810162159` (release channel, `geckoview-arm64-v8a`). That's the newest
GeckoView that builds on RN 0.86's toolchain (AGP 8.12, compileSdk 36): from 154 on, the AAR metadata
demands compileSdk 37.1+ and its POM pulls androidx.core 1.19 / lifecycle 2.11, which need AGP 9.1.
Move to 154+ once Expo/RN ship AGP 9.1 + compileSdk 37. The module excludes kotlin-stdlib (GeckoView is
pure Java; its POM asks for kotlin-stdlib 2.3 which RN's Kotlin compiler can't read), and the config plugin
still pins androidx.core to 1.18 if anything asks for 1.19+. Bump the version in
`modules/gecko-view/android/build.gradle` (or `-Psurffish.geckoviewVersion=`).

Shared code: Metro watches `../src/shared`; only platform-free files are imported (never Electron/main).

## Features

| | |
|---|---|
| Tabs | multiple GeckoSessions, grid switcher with thumbnails, close/undo, restore last closed, session restore on relaunch (incl. back/forward history via Gecko SessionState), lazy session creation |
| Address bar | bottom bar, autocomplete from history + bookmarks + open tabs (desktop's `buildAddressSuggestions`) + engine suggestions, desktop's search engines + keywords/!bangs, lock/security sheet, progress bar, reload/stop |
| Extensions | uBlock Origin installed from AMO on first run (enabled, allowed in private); Extensions screen searches AMO (API v5, `app=android`), install with permission prompt, enable/disable, private-tab toggle, remove, options page; browser-action popups in a sheet, actions listed in the menu |
| Private tabs | `usePrivateMode`, purple chrome, own page in the switcher, never in history/session |
| Bookmarks / history | expo-sqlite, add from menu star, search, rename, delete, clear history |
| Page tools | downloads -> Android DownloadManager (blob:/data: streamed to MediaStore Downloads), find in page, desktop site, share, open in app, copy clean link, long-press menu (links/images/media) |
| Intents | VIEW http/https (can be default browser), SEND text/plain and WEB_SEARCH open a tab |
| Permissions | camera/mic/location/notifications/etc. always prompted in a sheet (plus the Android runtime prompt), never silently denied; granted ones listed in the site sheet |
| Prompts | alert/confirm/prompt, select, date/time, colour, file upload, HTTP auth, popup-blocked, beforeunload, repost, Web Share |
| Theme | follows system light/dark, Surffish icon |

## Stubbed / not yet

- **SOCKS5 proxy**: Settings shows it as planned. Plan: a tiny built-in extension using
  `browser.proxy.onRequest`, configured from Settings.
- **Sync (later)**: no sync code. The db mirrors desktop's `surffish.db` (feat/sqlite-store):
  every synced row has `id` (uuidv7), `device_id`, `created_at`, `updated_at`, `hlc` (same stamp
  format as `src/shared/sync-clock.ts`) and `deleted_at` tombstones; INSERT/UPDATE triggers keep an
  `oplog` with the newest op per row, and `sync_peers` is there. Planned transport is Inkfish-style
  direct P2P: LAN sealed HTTP, phone drives, QR pairing with the Mac. No server.
- Per-site permission management UI (Gecko remembers allowed content permissions; clearing is all-sites).
- Reader mode, tab groups, Spaces, page watchers from desktop.
- x86_64 builds (emulators): add `geckoview-x86_64` + the ABI if needed.
