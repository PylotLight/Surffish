# src/native/macos

Native macOS code. Linux can't build any of it; CI's `native-macos` job and a Mac do.

- `mac-trackpad-swipe.mm`: AppKit addon for two-finger back/forward and Space swipes. Built by `scripts/build-mac-trackpad-swipe.ts` (part of `bun run build`) to `out/native/mac-trackpad-swipe.node`. Ships in the app.
- `google-sign-in/main.swift`: small AppKit/`WKWebView` app that runs Google sign-in (Google refuses embedded Chromium) and hands the cookies back to Surffish. Built by `scripts/build-google-sign-in.ts` to `out/native/google-sign-in`. Ships in the app.
- `Package.swift`, `Sources/`, `Tests/`, `Scripts/`: a SwiftPM `WKWebView` + `WKWebExtensionController` experiment (macOS 15.4+). Not part of the app; CI runs `swift test` and `swift build` so it keeps compiling. Locally: `./Scripts/test-macos.sh`, `swift run SurffishNative`, or `./Scripts/package-and-run.sh` for an ad-hoc-signed `.app`.
