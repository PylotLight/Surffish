# Chrome Web Store extensions

Surffish can install ordinary Chrome Web Store extensions into the browser session tabs use. The first verified extension is **Modern for Hacker News** (`dabkegjlekdcmefifaolmdhnhdcplklo`, MV3 1.14).

## Installing

- **Settings → Integrations → Chrome Web Store extensions**: paste a store link (`chromewebstore.google.com/detail/<slug>/<id>`, legacy `chrome.google.com/webstore/detail/…` works too) or a bare 32-letter ID.
- **From the store page in Surffish**: on an extension's detail page the toolbar shows **Add to Surffish**, and the store's own "Add to Chrome" / "Switch to Chrome" button is relabelled **Add to Surffish** (a session frame preload, `src/preload/web-store-page.cjs`; the page never gets a bridge, and main reads the ID from the frame's own URL).

Every install or update shows a confirmation with the compatibility verdict, missing features, Surffish shims, permissions, and site access.

## Pipeline

1. Download `https://clients2.google.com/service/update2/crx?response=redirect&prodversion=<Chromium version>&acceptformat=crx2,crx3&x=id%3D<ID>%26uc` through the browser session (proxy honoured), allowing only Google update/CDN hosts on every redirect (`restricted-fetch.ts`, shared with Bramble's release download).
2. Parse the CRX2/CRX3 header (`crx.ts`), find the publisher proof whose key hashes to the CRX ID, require that ID to equal the requested one, and verify the RSA signature over the signed header + ZIP.
3. Unpack the ZIP with the shared bounded extractor (`extractExtensionZip` in `bramble-release.ts`), skipping `_metadata/`.
4. Compatibility gate (`shared/extension-compat.ts`, reusing the static API scanner from `password-extension-compat.ts`): **Supported**, **Partial** (installs with a warning and a list of gaps), or **Unsupported** (blocked: themes, apps, proxy/debugger, Firefox-style MV3 backgrounds, …). declarativeNetRequest is supported (see below); the gate reads the static rulesets and lists, as a gap, any rules Surffish can't enforce.
5. Stage a copy (`web-store-extension-adapter.ts`): drop `update_url`, pin the store identity by adding the publisher key as `manifest.key`, wrap the background worker (`surffish-extension-background.js` next to the original), prepend the shim to isolated-world content scripts, and inject it as the first script of every extension HTML page.
6. Activate atomically into `userData/extensions/<id>/<version>` with rollback (`extension-staging.ts`, shared with Bramble), load it with `session.extensions.loadExtension`, check the loaded ID, and record it in `userData/extensions/installed.json`. Enabled extensions load at startup before restored tabs. A changed worker script drops the stale service-worker registration, as for Bramble.

## Compatibility shims

Injected only into extension-owned contexts (worker, extension pages, isolated content scripts):

- `chrome.storage.sync` → `chrome.storage.local` (Electron exposes `storage.sync`, but every call throws). Data stays on this device.
- `chrome.management.get/getSelf` → minimal self info (`installType: 'normal'`, `enabled: true`). Worker and extension pages only.
- `chrome.tabs.query/get/create/update/reload/remove` and `runtime.openOptionsPage` in popups/options pages → Surffish's own tabs over the `surffishExtensionHost` preload bridge (`extension-host.cjs`). Electron's own `tabs.query` returns no tabs, and `tabs.create` is missing. `url`/`title` are exposed only with `tabs`, `activeTab` (active tab), or matching host access. Extensions may open only web pages and their own pages.

- `chrome.webNavigation` (missing in Electron) → events Surffish forwards from tab navigations (see the bridge below). `onBeforeNavigate`, `onCommitted`, `onDOMContentLoaded`, `onCompleted`, `onErrorOccurred`, `onHistoryStateUpdated`, `onReferenceFragmentUpdated` with Chrome's frame ids (0 for the main frame, else the frame tree node id, which is what `chrome.scripting` targets), URL filters, and `getFrame`/`getAllFrames`. Worker only.
- `chrome.declarativeNetRequest.update*` → the native call, then a note to the bridge so Surffish re-reads the rules.
- `chrome.notifications` → resolves without showing anything (so report/notify paths don't throw).
- `tabs.query` in the worker hides Surffish's bridge page.

Paid/pro state is never faked: ExtPay's `paid` flag comes from extensionpay.com, so paid features stay locked unless the user pays.

## declarativeNetRequest

Electron 44 ships the DNR API and its engine would enforce rules, but only while the session has no `webRequest` listeners; Surffish always has one (ad blocker, kill switch, HTTPS-only), so natively nothing is blocked. Surffish enforces the rules itself:

- Matching (`shared/dnr.ts`, unit-tested): `urlFilter` (`*`, `|`, `||`, `^`, case), `regexFilter`, `requestDomains`/`excludedRequestDomains`, `initiatorDomains`/`excludedInitiatorDomains` (and the old `domains`/`excludedDomains`), `resourceTypes`/`excludedResourceTypes`, `requestMethods`, `tabIds` (session rules), `domainType`. Actions `block`, `allow`, `allowAllRequests`, `redirect` (url, extensionPath, transform, regexSubstitution), `upgradeScheme`, `modifyHeaders` (request + response). Chrome's priority and action precedence. Rules are indexed by a token their URL must contain (like uBO), so a request only tests a handful of rules. Rules with conditions Surffish doesn't support (e.g. `responseHeaders`) are skipped and listed as a gap at install.
- Enforcement (`main/extension-dnr.ts`): a session request gate the ad blocker's single `onBeforeRequest` handler runs before the filter engine (after the kill switch / HTTPS-only gates); `modifyHeaders` through request-gate header hooks (`onBeforeSendHeaders` is only attached while some rule needs it; response headers fold into the ad blocker's `onHeadersReceived`). Only the profile session (where extensions run); never the browser's own or extensions' requests. Host-access rules follow `declarativeNetRequest` vs `declarativeNetRequestWithHostAccess`.
- Rule sources: static rulesets from the package; dynamic + session rules and the enabled rulesets read back from the native API by the bridge after each change. Surffish keeps `userData/extensions/<id>/dnr-state.json` so the first pages after a restart are filtered before the worker runs. Enabled rulesets reset to the manifest defaults on update, as in Chrome.
- `bun run bench:dnr [rules.json]` measures the matcher (I still don't care about cookies 1.1.9, 1734 rules: ~2–8 µs per request in Bun).

## Extension bridge

Electron offers no channel into an extension's worker (service-worker preloads don't run for extension workers). For extensions that use `webNavigation` or DNR, Surffish loads a hidden page, `surffish-bridge.html` (written into the staged copy, without the shim), with the `extension-bridge.cjs` preload. It relays between main (IPC) and the worker (`chrome.runtime.sendMessage`, which also wakes a stopped worker). Messages carry a `__surffishBridge` key; the shim hides them from the extension's own `onMessage` listeners.

## UI

Each enabled extension with a popup gets a toolbar button; clicking opens `action.default_popup` in a frameless popover right-aligned under the icon (the same `anchoredPopupBounds` logic as Bramble), sized like Chrome (explicit page width, else shrink-to-fit, clamped to 25–800 × 25–600). It closes on blur or Esc. Right-click opens the options page when there is one. The Settings row has On/off, Options, Check for update (re-downloads and swaps versions when newer), and Remove (also clears the extension's storage).

## Ad blocking

The ad blocker never blocks `chrome-extension://` resources or requests made from extension pages/workers. It also leaves alone hosts installed extensions depend on (`extensionpay.com` when an extension ships ExtPay or injects into extensionpay.com).

## Known gaps

No badge text or dynamic icons, no `contextMenus`, `notifications` (calls succeed, nothing is shown), `commands`, `windows`, `sidePanel`, `identity`, or runtime permission prompts. `storage.sync` does not sync between devices. Popups opened programmatically (`action.openPopup`) are not supported. `tabs.*` shims cover popups and options pages only; background workers get Electron's own `tabs` (tab events such as `tabs.onUpdated` don't fire). DNR: no `getMatchedRules`/`onRuleMatchedDebug` feedback, `allowAllRequests` is tracked per tab (main frame) rather than per sub-frame, and an uninstall + reinstall may bring back dynamic rules Electron kept.

## Probing

`bun scripts/fetch-web-store-extension.ts modern-for-hn|i-still-dont-care-about-cookies [out-dir] [--raw] [--probe]` downloads, verifies, and stages an extension as Surffish would. `--probe` then runs `scripts/electron-real-extension-probe.cjs` on it (needs a display; use `xvfb-run` on Linux).

`bun run test:electron-extension-dnr` (after `bun run build`) installs a small generated DNR + webNavigation + scripting extension into a throwaway profile and checks blocking, redirects, header changes, a dynamic allow rule and cookie-banner hiding in a page and an iframe. `SURFFISH_DNR_SMOKE_EXTENSION=<dir staged by fetch-web-store-extension.ts>` runs it against the real extension.
