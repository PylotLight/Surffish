# Native macOS WebKit evaluation

Sockfish's current app remains Electron/Chromium. The native experiment is isolated under [`native/macos`](../native/macos/README.md); it does not modify the Electron runtime, profile, or UI.

## What the proof of concept exercises

The prototype is a SwiftPM macOS app targeting **macOS 15.4+**. It creates a `WKWebView` with a persistent `WKWebsiteDataStore` and an attached `WKWebExtensionController`. It is deliberately a single-view test host, not a production browser or a full Safari replacement.

| Capability | Automated check | What is not proven by that check |
|---|---|---|
| `WKWebExtension(resourceBaseURL:)` | Parse a local fixture from a directory and ZIP; inspect Manifest V3 metadata and requested permissions. | Compatibility of any third-party extension. |
| `WKWebExtensionContext` and `WKWebExtensionController.load/unload` | Load and unload the fixture; assert context/controller state. | Chrome/Safari parity, extension popup/tab behavior, or persistence across launches. |
| WebExtension permission callbacks | The host prompts separately for manifest import, requested permissions, URL match patterns, and URL access; denial is the safe option. | A production-grade permission manager or per-site UI. |
| `WKWebsiteDataStore.proxyConfigurations` + `Network.ProxyConfiguration(socksv5Proxy:)` | Configure and clear a loopback SOCKSv5 proxy; verify proxy failover is disabled. | Actual end-to-end network routing, DNS behavior, WebRTC, or leak resistance. Test those on a Mac with a real tunnel. |
| WebAuthn in `WKWebView` | Execute a JavaScript feature-surface probe, and read `ASAuthorizationWebBrowserPublicKeyCredentialManager` state without requesting access. | Passkey registration/assertion; those require entitlements and user/device configuration. |
| Navigation boundary | Reject non-HTTP(S) URLs in the prototype. | The complete security model needed for a real browser. |

Run the automated checks on macOS from the repository root:

```sh
cd native/macos
./Scripts/test-macos.sh
swift run SockfishNative
```

The project also has a `macos-15` GitHub Actions job. A locally packaged `.app` is optional: `./Scripts/package-and-run.sh` applies an **ad-hoc** signature only. Neither SwiftPM development nor local ad-hoc signing requires a paid Apple Developer membership. This is distinct from Developer ID distribution, notarization, Mac App Store publication, and Apple-managed entitlements. Linux cannot compile or run WebKit; the native CI job and the user's Mac provide the Apple runtime.

## Extension installation and realistic fit

Apple's [`WKWebExtension(resourceBaseURL:)`](https://developer.apple.com/documentation/webkit/wkwebextension/init(resourcebaseurl:)) accepts a local directory with a `manifest.json` or a ZIP containing one. [`WKWebExtension(appExtensionBundle:)`](https://developer.apple.com/documentation/webkit/wkwebextension/init(appextensionbundle:)) accepts a configured app-extension bundle containing its manifest. The prototype's **Add extension…** UI supports those formats and displays declared permissions/site patterns before loading.

The app's controller and data store are separate from Safari's. Enabling an extension in Safari does not install it into this prototype, and neither Safari cookies nor extension storage transfer. The native API may parse/load a package that still fails in use because of unsupported extension APIs, background-worker behavior, tab/window lifecycle events, identity/authentication flows, popup hosting, or extension-specific requirements. This POC does not implement Safari's full tab/window/action host, so popup-dependent flows are especially incomplete. Do not use real vault credentials in initial trials.

| Extension | Practical installation paths | Expected status in this host |
|---|---|---|
| **uBlock Origin (full)** | Full uBlock Origin is not the Safari product. The separate [uBlock Origin Lite (uBOL)](https://github.com/uBlockOrigin/uBOL-home) project lists a Safari/App Store version. Standard Safari install: get the Lite app from the Mac App Store, open Safari → Settings → Extensions, and enable it. To test in this independent host, select a compatible local Safari WebExtension directory/ZIP or extension `.appex` if the release provides one. | Lite is not full uBO. A Safari App Store installation affects Safari only; it is not automatically added to this WKWebView. The local package/bundle must be accepted by Apple's initializer, then filtering, content rules, UI, and settings still need runtime tests. |
| **Bitwarden** | Bitwarden's official [Safari extension instructions](https://bitwarden.com/help/install-safari-app-extension/) say its Safari WebExtension is packaged with the macOS desktop app from the App Store; launch Bitwarden once, then enable Safari → Settings → Extensions → Bitwarden. For the prototype, locate the bundled Safari `.appex` inside `Bitwarden.app/Contents/PlugIns` and select it, or use a raw Safari extension folder/ZIP if the publisher supplies one. | The official Safari route is for Safari. Importing the bundle into this separate host is an experiment, not guaranteed. Validate install/unlock, permission behavior, autofill, popup integration, and persistence on a disposable profile before using a real vault. |
| **Bramble** | Bramble's [official site](https://bramble.sh/) currently lists Chrome-family browsers and Firefox, not Safari. Obtain its Chromium extension output or source, unpack/build it so `manifest.json` is at the selected directory/ZIP root, then try importing that package. | No official Safari package is advertised. Treat it as an unsupported port attempt: its Manifest V3 service worker and Chrome-specific APIs may not run in WebKit. The Firefox add-on package may be different from its Chromium build. |

Apple's general [Safari extension installation guide](https://support.apple.com/en-us/102343) describes App Store installation and enabling in Safari Settings. That is the right path for normal Safari use; it is not an extension manager for third-party WKWebView apps.

## SOCKSv5 API boundary

[`WKWebsiteDataStore.proxyConfigurations`](https://developer.apple.com/documentation/webkit/wkwebsitedatastore/proxyconfigurations-cdc1) is available on macOS 14+, and [`Network.ProxyConfiguration`](https://developer.apple.com/documentation/network/proxyconfiguration) provides a SOCKSv5 initializer on macOS 14+. The extension API is newer and sets the combined minimum OS to macOS 15.4. The prototype uses `127.0.0.1:1080`, disables non-proxy failover, and scopes the setting to its WebKit store. This is not a VPN or a guarantee that every type of browser traffic is proxied.

## Passkey and signing boundary

There are two related WebKit passkey checks, but they should not be confused with an entitlement to use passkeys for arbitrary sites:

- `WKWebView` can expose WebAuthn JavaScript support on macOS 13.3+. Apple's [passkey guidance](https://developer.apple.com/documentation/authenticationservices/supporting-passkeys) says an app using a web view must associate the relying party as a `webcredentials` domain and publish the corresponding Apple App Site Association file. Without that relationship, that site's passkey request fails.
- Apple's browser-specific `ASAuthorizationWebBrowserPublicKeyCredentialManager` and the `com.apple.developer.web-browser.public-key-credential` entitlement support browser access to passkeys for relying parties. Apple says an **Account Holder for an organization Developer account** must submit the request form; Apple reviews and provisions the managed entitlement. See Apple's [entitlement requirements](https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.developer.web-browser.public-key-credential) and [browser passkey flow](https://developer.apple.com/documentation/authenticationservices/authenticating-people-by-using-passkeys-in-browser-apps).

The code probes JavaScript API presence and reports the browser credential authorization state, but intentionally does not request access or attempt registration/assertion. An ad-hoc local signature cannot grant Apple's managed entitlement, and no signing/entitlement request is part of this task. Therefore **general-site passkey support cannot be validated or enabled under the stated no-paid-membership constraint**. Testing a relying party the developer owns would still require its associated-domain configuration and a signed app with the associated-domains entitlement.

## Decision boundary

This is a native runtime experiment, not an Electron engine switch. Even if an individual extension passes the fixture/runtime tests, a production macOS browser would still need durable profile/extension storage, a tab/window model implementing WebExtension events, action popups/options pages, native download/navigation UI, robust permission controls, proxy routing verification, and ongoing extension/API compatibility work. Keep the Electron app as-is until the exact extension workflows have been validated on the target Mac.

## Primary references

- [WKWebExtensionController](https://developer.apple.com/documentation/webkit/wkwebextensioncontroller) · [WKWebExtension](https://developer.apple.com/documentation/webkit/wkwebextension) · [WebKit proxyConfigurations](https://developer.apple.com/documentation/webkit/wkwebsitedatastore/proxyconfigurations-cdc1)
- [Network SOCKSv5 proxy configuration](https://developer.apple.com/documentation/network/proxyconfiguration) · [WKWebView passkeys](https://developer.apple.com/documentation/authenticationservices/supporting-passkeys) · [Browser passkey entitlement](https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.developer.web-browser.public-key-credential)
- [uBOL upstream](https://github.com/uBlockOrigin/uBOL-home) · [Bitwarden Safari installation](https://bitwarden.com/help/install-safari-app-extension/) · [Bramble](https://bramble.sh/)
