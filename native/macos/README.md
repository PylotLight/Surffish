# Sockfish native macOS proof of concept

This SwiftPM project is deliberately separate from the Electron app. It targets **macOS 15.4+**, the minimum for Apple's embedded `WKWebExtensionController` and `WKWebExtension` APIs. It uses one `WKWebView`, a persistent WebKit data store, explicit SOCKSv5 proxy configuration, a small extension importer, and WebAuthn capability probes. It is an experiment, not a replacement browser or a production security boundary.

## Build and test on your Mac

No paid Apple Developer membership is needed to compile or run locally:

```sh
cd native/macos
./Scripts/test-macos.sh
swift run SockfishNative
```

`test-macos.sh` runs the native XCTest suite and builds the app. The suite uses a local test extension fixture and does not download or execute uBlock Origin, Bitwarden, or Bramble. It covers the real WebKit API paths for:

- loading an extension from a directory and ZIP with `WKWebExtension(resourceBaseURL:)`, inspecting manifest metadata, and loading/unloading a `WKWebExtensionContext` through `WKWebExtensionController`;
- creating and clearing a SOCKSv5 `ProxyConfiguration` on a `WKWebsiteDataStore`, with direct failover disabled;
- executing WebAuthn capability detection JavaScript in `WKWebView` and reading the browser passkey-authorization state without opening an access prompt;
- resolving hosts and multiword Brave Search queries from the address bar, and rejecting non-HTTP(S) page navigation;
- discovering an extension's default toolbar action and popup metadata from a fixture with a real popup page.

For a Launch Services `.app` bundle, optionally use `./Scripts/package-and-run.sh`. It ad-hoc signs the local build (no Developer ID, notarization, or paid account) and creates no special entitlements. Alternatively, `swift run` launches from the terminal without the bundle packaging step. The app requests regular foreground activation and focuses the address field after its window appears, including for SwiftPM launches. If macOS blocks a downloaded build, build it locally rather than removing Gatekeeper protections.

Debug builds opt in the browser page and extension popup `WKWebView`s to Safari Web Inspector; release builds leave inspection disabled. To investigate a blank extension popup, open Safari Settings → Advanced, enable **Show features for web developers**, then in Sockfish open the popup and choose its view from Safari's **Develop** menu. Check the Console for JavaScript exceptions and failed resource requests. If Web Inspector lists the extension background page or service worker, inspect that too; a popup can render blank when its background script fails or uses an unsupported API. Save the first relevant exception and its source/line before changing extension permissions or trying another package.

The repository's macOS CI job runs `swift test` and `swift build` on an Apple runner. The current development computer is Linux, so the WebKit runtime checks must run on that runner or your Mac; Linux cannot compile or execute Apple's WebKit frameworks.

## Try an extension

In the prototype, type a host (for example, `example.com`) or a query (for example, `Bramble extension`) into the editable address bar. Bare queries are sent to Brave Search; host-like inputs are opened over HTTPS. The page area is empty until you navigate. Choose **Add extension…** and select an unpacked WebExtension directory, a ZIP whose root contains `manifest.json`, or a Safari Web Extension `.appex` bundle. WebKit presents the manifest's declared permissions and website patterns before loading; runtime permission requests get separate Allow/Deny prompts. Each loaded extension with a manifest action gets a visible toolbar icon/button. Click it to dispatch the action or open its WebKit-managed popup popover. **Extension diagnostics** refreshes WebKit's per-context parse/runtime error list and host-observed popup navigation/presentation failures. In particular, `WKWebExtensionContextErrorDomain` code `6` means WebKit could not load the extension's background content; it is not a failure to load the browser's current webpage. The error alone does not identify whether the cause is a script/runtime problem or an API the extension expects that this host does not support. A popup may also be blank if it depends on the failed background content. Use a disposable profile and inspect errors. The import executes third-party extension code, so do not use a real password vault in this proof of concept.

This host currently has one page view and no multi-tab/window lifecycle. WebKit provides the popup host used here, but loading and opening a popup does not imply that all of an extension's required APIs, background mode, identity flow, tab events, or Chromium-specific behavior are supported. The diagnostics panel displays errors surfaced by WebKit, but a clean list is not proof of compatibility or full functionality.

## Extensions named in the project

| Extension | Practical path | What to expect in this prototype |
|---|---|---|
| **uBlock Origin (full)** | Full uBO is not a Safari product. For a Safari/WebKit-flavoured attempt, the separate **uBlock Origin Lite (uBOL)** project publishes a Safari build through the App Store; its official repository also documents platform-specific release assets. In the prototype, import a compatible Safari WebExtension directory/ZIP if one is available, or an extension `.appex` bundle. | Lite is not the full uBO feature set. A Safari App Store install enables it in Safari, not automatically in this independent WKWebView. Do not assume its App Store app bundle can be transplanted; use only an extension package accepted by Apple's initializer and verify filters, content rules, popup, and preferences on-device. |
| **Bitwarden** | Install the Bitwarden macOS app from the Mac App Store, launch it once, then enable **Safari → Settings → Extensions → Bitwarden**. For this host, inspect the app's `Contents/PlugIns` for the Safari extension `.appex` and try **Add extension…** on that bundle; Apple's `WKWebExtension(appExtensionBundle:)` is the documented ingestion route. A raw Safari WebExtension ZIP/directory is another route if the publisher supplies one. | The official Safari install is for Safari; it does not share cookies, vault state, or extension state with Sockfish. The app-extension bundle route is an experiment, not a guarantee of compatibility. Do not import a real vault until install, unlock, autofill, permissions, and persistence pass on a disposable account/profile. |
| **Bramble** | Bramble's official site currently lists Chrome-family browsers and Firefox, not Safari. Download/build its published Chromium extension package or source, unpack it to a directory with `manifest.json`, then select that directory/ZIP in the prototype. | Treat as an unsupported port attempt. Its Chrome MV3 service-worker and API requirements may not map to WebKit; parsing the manifest is not proof of runtime behavior. Its Firefox AMO package may also differ from Chromium output. |

The standard Safari routes above install extensions **in Safari**. This prototype has its own controller and data store; Safari does not provide a switch that installs a Safari extension into arbitrary WKWebView apps.

## Scope and limitations

- Proxying is scoped to this `WKWebsiteDataStore`; with the configured local SOCKSv5 endpoint unavailable, page requests should fail rather than silently fall back direct. The property test verifies configuration, not every traffic type or leak behavior. Test with a local SSH tunnel and an independent egress-IP check on your Mac.
- The passkey button reads browser credential authorization state and probes the JavaScript API surface. It does not request access or perform registration/assertion.
- For a site's own passkeys, Apple's WebKit guidance requires the site's `webcredentials` associated domain and an `apple-app-site-association` file. General browser access to passkeys for arbitrary relying parties requires `com.apple.developer.web-browser.public-key-credential`. Apple says requesting that managed entitlement requires the Account Holder of an organization Apple Developer account to submit a request; Apple reviews it. Ad-hoc signing cannot grant it. Since you do not intend to pay for membership or submit that request, **general-site native passkeys are out of scope**.
- Public App Store distribution, Developer ID distribution/notarization, and Apple's restricted passkey entitlement are not part of this POC. The local app and WebKit API smoke tests do not require paid membership.
- Do not enable App Sandbox for this first local test build; the prototype is not hardened or audited. Keep the native experiment isolated from the user's normal browser profile and credentials.

See [`../../docs/native-webkit-evaluation.md`](../../docs/native-webkit-evaluation.md) for architecture comparison and sources.
