# Surffish Native WebKit PoC

A native macOS architecture spike for Surffish evaluating:

- **Stack**: Swift + AppKit + WKWebView + WKWebExtension + LocalAuthentication (Touch ID)
- **Branch**: `poc-native-webkit`

---

## What's Included in this Milestone

### 1. Liquid Glass & Vibrancy (Resolves Issue #330)

- `window.isOpaque = false` and `window.backgroundColor = .clear` enables true macOS desktop blur.
- Root and sidebar layers use `NSVisualEffectView` (`.sidebar` and `.underWindowBackground` with `.behindWindow` blending mode).
- Surffish dark slate glass tint overlay (`rgba(18, 21, 25, 0.65)`).
- Web content is framed as an inset rounded card (`cornerRadius: 10`, `1px` subtle highlight border `rgba(255, 255, 255, 0.12)`).

### 2. Native macOS Gestures

- **Two-Finger Swipe Navigation**: `allowsBackForwardNavigationGestures = true` provides native Apple Liquid swipe back/forward with live page peeking and rubber-band physics.
- **Trackpad Pinch-to-Zoom**: `allowsMagnification = true`.

### 3. Real Bramble Extension + Toolbar Popup

- Bundled the real **Bramble 1.38.0 release** (`poc-native/Resources/bramble`).
- `WKWebExtension` loads Bramble with its MV3 background worker and popup.
- The omnibox toolbar features a **🫐 Bramble button**: clicking it opens an `NSPopover` hosting Bramble's actual `popup.html` interface.
- Native biometric quick unlock via `LocalAuthentication` (`LAContext`) for instant Touch ID authentication.

### 4. Dynamic Extension Installer

- Click the **`🧩+`** button in the toolbar or sidebar to open the **Install Extension** sheet:
  - **Chrome Web Store**: Enter an extension ID or store URL (e.g. `cjpalhdlnbpafiamejdnhcphjbkeiagm` for uBlock Origin or `nngceckbapebfimnlniiiahkandclblb` for Bitwarden) &rarr; automatically downloads the CRX3, unpacks it to `Application Support/SurffishNative/Extensions/`, and dynamically mounts it into `WKWebExtensionController`.
  - **Disk Picker**: Choose any unpacked folder, `.zip`, `.crx`, or `.xpi` file.

### 5. Proper Omnibox, Search, and Multi-Tabs

- **Dark Glass Omnibox Pill**:
  - Smart address resolution: URL/host detection vs. query routing to DuckDuckGo.
  - Security lock indicator (🔒 HTTPS / ⚠️ non-HTTPS).
  - Animated progress bar tracking `estimatedProgress`.
  - Controls: Sidebar toggle `☰`, Back `◀`, Forward `▶`, Reload/Stop `⟳`.
- **Multi-Tab Sidebar**:
  - Vertical tab rows with active glow, page titles, loading spinner, and close `✕` button.
  - `+ New Tab` button.
  - Live memory sampler (`RSS: ~38 MB`).
  - Native `WKContentRuleList` AdBlock toggle (`🛡️`).

---

## Building and Running

To recompile:

```bash
./scripts/build-native-poc.sh
```

To run:

```bash
open poc-native/build/SurffishNative.app
```

or run attached to terminal:

```bash
./poc-native/build/SurffishNative.app/Contents/MacOS/SurffishNative
```
