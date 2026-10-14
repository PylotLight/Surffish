# Bramble extension in Surffish

Surffish provides a **Bramble-specific extension integration**. It is not a general Firefox/Chrome extension manager. Bramble’s vault popup, setup, and customization remain in Bramble’s own extension UI; **Settings → Integrations** handles install, update checks, version, and effective permissions. The browser toolbar keeps a single Bramble icon that opens the compact password-grab popup. **Create your vault** opens Bramble’s options/setup page in a regular Surffish browser tab, matching the normal extension behavior.

## Install and update

1. Open **Settings → Integrations → Bramble password manager**.
2. Choose **Check for updates** to ask the Bramble GitHub Releases API for the newest stable `*-firefox` release. The version and result appear in Integrations.
3. Choose **Install** or **Update**. Before extension code is activated, Surffish shows the selected version, integrity checks, and requested extension/site permissions. Cancel leaves the existing install unchanged.
4. After installation, use the Bramble toolbar icon to open the compact popup. **Create your vault** opens setup in a browser tab; **Setup / customize** in Integrations opens or focuses that same tab.

Installation and updates are explicit; Surffish does not silently run a downloaded release. The app retains a verified release ZIP in its user-data directory and loads the adapted extension from Surffish’s persistent browser profile. On subsequent starts it verifies the retained archive’s SHA-256 before staging the extension. Updating replaces extension files at a stable path, checks the extension ID has not changed, rolls back on load failure, and does not clear the browser profile or extension storage.

### How the release is sourced

The currently published Bramble Firefox GitHub release includes a ready-to-load `bramble_firefox_<version>.zip` and `SHA256SUMS`; no Bramble source clone, pnpm, Rust, `wasm-pack`, or build-time bundling is required for end users. Surffish selects the newest stable semantic version tagged `*-firefox` (excluding drafts/prereleases), validates the exact GitHub release URL, bounds download and extraction sizes, rejects unsafe ZIP paths and symlinks, checks the ZIP against `SHA256SUMS`, and compares GitHub release asset digests when available. Redirect hops are checked against approved GitHub release hosts and continue through the browser session, so the configured SOCKS proxy applies. The actual Bramble WASM and Firefox bundle are inside the upstream ZIP.

The Firefox ZIP does **not** publish a detached maintainer signature on GitHub. SHA256SUMS and GitHub’s asset digest provide integrity checks against accidental or in-transit corruption and disagreement between release metadata and bytes; they are not an independent code-signing identity. This limitation is shown in the confirmation prompt. Installation remains a user action. Surffish does not change the Bramble source project or silently execute code during builds.

### Permissions and behavior

Bramble asks for broad `<all_urls>` access so its content scripts can match websites for autofill and its passkey bridge. The confirmation dialog lists upstream-declared API/site permissions; Settings shows the effective permissions in the adapted install. Surffish removes Firefox’s `identity` permission because Electron does not provide Bramble’s Firefox identity/OAuth flow. Bramble’s Google Drive/OAuth backup is therefore unavailable in Surffish. The existing local vault and encrypted backup/restore behavior remain in Bramble’s own UI.

Surffish does not read, log, or store Bramble’s master password unless you turn on **Quick unlock** (below). Vault data belongs to Bramble’s extension storage in the persistent Surffish browser profile. Removing or changing extension files does not itself delete that data; use Bramble’s vault-management UI for vault deletion.

### storage.onChanged in Bramble’s worker

Electron 44 never delivers `chrome.storage.onChanged` to an extension’s MV3 service worker (extension pages get it; even the worker’s own writes are not reported to it). Bramble’s background reschedules its `vault:autolock` alarm from that event, so a new auto-lock timeout used to apply only after the next unlock or worker restart. Surffish’s Bramble shim (`surffish-bramble-browser-alias.js`) has Bramble’s always-running offscreen page relay **local-area** changes to the worker, which replays them to the listeners Bramble registered. Session-area changes (key material) are not relayed; large values (vault blobs) are relayed as keys only. The replay stops if the native event ever starts firing in the worker.

## Quick unlock (PIN / Touch ID)

Bramble has no PIN unlock ([flythenimbus/bramble#88](https://github.com/flythenimbus/bramble/issues/88)) and its own Touch ID slot is a WebAuthn credential that Electron cannot create. **Settings → Integrations → Quick unlock for Bramble** adds a Surffish-only PIN (4–8 digits) and, on a Mac with Touch ID, a Touch ID button. It is layered on the unmodified extension:

- **Needs a vault:** setup is offered only once Bramble has a vault. Surffish checks from Bramble’s own offscreen page, read-only: `vault.registry` in `chrome.storage.local` must list a vault whose encrypted blob (`vault-blob-b64:<id>`, or the pre-registry `vault-blob-b64`) is non-empty; only booleans leave the page. Until then **Set up PIN…** is disabled with “Create your Bramble vault first” (Settings re-checks every 2 s while it shows that hint, and on window focus), and the main-process enrol handler refuses too. Nothing runs at startup for this.
- **Setup:** you type the master password once into Surffish’s own form. Main encrypts it with AES-256-GCM under `HKDF(scrypt(PIN, salt) ‖ deviceKey)`; the Touch ID slot uses `HKDF(deviceKey)` behind `systemPreferences.promptTouchID`. The 32-byte device key is random; it is written to disk only encrypted by Electron `safeStorage` (Keychain on macOS). (Argon2id is used when the runtime supports it; Electron 44’s BoringSSL does not, so it is scrypt N=2^17, r=8.)
- **Require master password after Surffish restarts** (default on): the PIN and Touch ID slots live in main-process memory only. On disk there is just the PIN wrapped under the master password, so after a restart Surffish’s panel asks for the master password once and the PIN works again. Off: the slots and the safeStorage-protected device key are kept in `bramble-quick-unlock.json` (0600), so the PIN survives restarts.
- **Unlock:** when Bramble’s popup shows its master-password form (detected read-only from an isolated world: one `masterPassword` field in a form, no confirm field), Surffish draws its own PIN panel over the popup in a separate sandboxed view. A correct PIN decrypts the master password in main, which fills Bramble’s field (native value setter + input event, so React sees it) and submits the form. **Use master password** hides the panel for that lock screen.
- **Lockout:** each attempt is written to disk as a failure before the PIN is checked and refunded on success, so killing Surffish never yields a free guess. Five wrong PINs wipe every slot; set it up again with the master password.
- **Master password changed:** if Bramble rejects the filled password, Surffish wipes quick unlock and says so.
- The panel covers the toolbar popup and the autofill “Vault locked” pop-out (both are that popup). Bramble’s options page in a tab is not covered; it shares the popup’s unlock state.

Threat model: a PIN is much weaker than a master password. Someone who can run code as you, or read Surffish’s memory while it runs, can get the master password. A copied profile alone is not enough: in the default mode nothing that opens Bramble is on disk, and in persisted mode the blob is also bound to the Keychain-protected device key, so the PIN space cannot be brute-forced offline from the file.

Checks against a real Bramble build (not in CI; they need the build):

```sh
xvfb-run -a electron --no-sandbox scripts/check-bramble-quick-unlock.cjs /path/to/bramble_firefox_X
bun run build && xvfb-run -a electron --no-sandbox scripts/check-bramble-quick-unlock-app.cjs /path/to/bramble_firefox_X
```

The first creates a vault through Bramble’s setup form, checks the storage relay (auto-lock alarm moves to the new timeout at once), and fills wrong and right passwords into the real popup. The second drives the whole feature in the built app: setup refused/disabled before a vault exists and enabled after, enrol, PIN panel over the locked popup, wrong PIN, right PIN typed on the keyboard, “Use master password”, the five-strike wipe.

## Manual smoke test

1. Build and launch Surffish. Open **Settings → Integrations → Bramble password manager** and choose **Check for updates**; confirm the version/status is shown.
2. Click **Install**. Review the native confirmation’s version, digest statement, and permissions; choose **Cancel** and verify the install state stays unchanged. Repeat and choose **Install Bramble**.
3. Confirm Integrations shows the installed version and effective site/API permissions. Use the Bramble toolbar icon; confirm it opens the 500×550 compact popup anchored beneath the icon and dismisses on outside focus or Escape.
4. Choose **Setup / customize** in Integrations. Confirm Bramble’s options/setup page opens in a regular Surffish browser tab. Create a disposable local vault and verify it can be locked and unlocked from the popup.
5. With the app offline, restart Surffish and confirm the already installed extension still loads from the locally retained archive. Reconnect, use **Check for updates**, and confirm the Settings status/error is informative.
6. For an update test, use an upstream release newer than the installed version. Cancel at the permission prompt once; verify the old popup and vault remain usable. Then confirm the update; verify the new version is shown and the prior vault is still present.

## Automated checks

```sh
bun run test
bun run typecheck
bun run build
```

The unit suite includes Bramble release selection, URL allow-list, GitHub/SHA256SUMS digest verification, ZIP extraction, and path-traversal rejection. The existing adapter tests verify the Firefox build adaptation and the existing UI/bridge smoke harness remains available:

```sh
bun run test:bramble-poc -- /path/to/bramble/packages/platform-extension/dist-firefox
bun run test:bramble-app-poc -- /path/to/bramble/packages/platform-extension/dist-firefox
xvfb-run -a bun run test:electron-extensions
xvfb-run -a bun run test:electron-host-bridge
```

Those two Bramble app-probe commands need a built upstream `dist-firefox` folder because they exercise the existing app integration against local source. That is a maintainer/test requirement only; normal Surffish users install from the GitHub release in Settings.

The app-level smoke harness uses a temporary profile and local-only test sites. It verifies vault create/lock/unlock, one conventional localhost password autofill flow, an opt-in localhost ES256 WebAuthn registration/assertion, the Join form without completing pairing, and encrypted backup restore without overwriting existing vault bytes. It does not verify live pairing/sync, every site’s autofill behavior, public relying parties, or a signed Bramble package.

## Upstream references

- [Bramble source and releases](https://github.com/flythenimbus/bramble)
- [Bramble Firefox 1.28.0 release](https://github.com/flythenimbus/bramble/releases/tag/1.28.0-firefox)
- [Bramble Firefox release workflow](https://github.com/flythenimbus/bramble/blob/main/.github/workflows/firefox-release.yml)
- [Bramble release verification workflow](https://github.com/flythenimbus/bramble/blob/main/.github/workflows/release.yml)
- [Electron extension API](https://www.electronjs.org/docs/latest/api/extensions)
