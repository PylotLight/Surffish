# src/native/macos

Native macOS code that ships in the app. Linux can't build any of it; CI's `native-macos` job and a Mac do.

- `mac-trackpad-swipe.mm`: AppKit addon for two-finger back/forward and Space swipes. Built by `scripts/build-mac-trackpad-swipe.ts` (part of `bun run build`) to `out/native/mac-trackpad-swipe.node`.
- `google-sign-in/main.swift`: small AppKit/`WKWebView` app that runs Google sign-in (Google refuses embedded Chromium) and hands the cookies back to Surffish. Built by `scripts/build-google-sign-in.ts` to `out/native/google-sign-in`.
