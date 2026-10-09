# Native macOS WebKit evaluation

Sockfish currently uses Electron's Chromium/Blink `WebContentsView` for remote pages. Electron documents a subset of Chrome extension APIs, loads unpacked extensions into persistent sessions, and explicitly does not target compatibility with arbitrary Chrome Web Store extensions ([Electron extension support](https://www.electronjs.org/docs/latest/api/extensions)). Changing the rendering engine is not needed to improve compatibility within that existing host.

## What a native WebKit path could provide

A separate macOS implementation using Swift and `WKWebView` can use Apple's Safari-style WebExtensions host. Apple documents `WKWebExtensionController` as managing loaded extension contexts and associating with `WKWebView` through its configuration; the controller is available on **macOS 15.4 and later** ([`WKWebExtensionController`](https://developer.apple.com/documentation/webkit/wkwebextensioncontroller)). This is a genuine native extension host, but individual extensions and APIs still need runtime testing; the existence of the API does not promise Safari or Chrome parity for every extension.

Apple also exposes proxy configurations on `WKWebsiteDataStore` beginning with **macOS 14** ([`WKWebsiteDataStore.proxyConfigurations`](https://developer.apple.com/documentation/webkit/wkwebsitedatastore/proxyconfigurations-cdc1)). Network's [`ProxyConfiguration`](https://developer.apple.com/documentation/network/proxyconfiguration) includes a SOCKSv5 initializer and is available on macOS 14+. If Sockfish needed both native extensions and SOCKSv5 through WebKit, the extension API sets the higher OS floor: macOS 15.4.

## Extension fit

[Bitwarden documents a Safari browser extension](https://bitwarden.com/help/getting-started-browserext/) packaged with its macOS desktop app. That makes it a useful real-world candidate for a native WebKit prototype, but it should still be tested for installation, permissions, toolbar UI, autofill, and background behavior.

[Bramble currently advertises Chrome-family browsers and Firefox](https://bramble.sh/), not Safari. WebKit compatibility should therefore be treated as unverified: inspect its extension APIs and manifest, then test or port it rather than assuming the Chrome build will run unchanged.

## Architecture and decision boundary

This would **not** be a drop-in engine switch or an Electron module. Sockfish would need a separate macOS browser-view implementation, native window/UI integration, extension lifecycle and permission UX, navigation and tab-event bridging, and proxy/data-store setup. Its WKWebView data store and extension setup would also be distinct from the current Chromium profile; existing cookies, storage, and extension state should not be assumed to transfer automatically. The current Electron app can remain the cross-platform path while a native macOS prototype is evaluated.

A focused prototype should answer whether the target extension(s) work end to end, whether the required extension APIs and permission prompts can be hosted safely, and whether the WebKit data store applies the local SOCKSv5 configuration to the expected traffic. Keep proxy guarantees scoped to what the platform actually routes; do not infer a system-wide VPN or leak-proofing guarantee from setting a proxy property.
