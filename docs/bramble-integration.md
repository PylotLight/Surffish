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

Surffish does not read, log, or store Bramble’s master password. Vault data belongs to Bramble’s extension storage in the persistent Surffish browser profile. Removing or changing extension files does not itself delete that data; use Bramble’s vault-management UI for vault deletion.

## Manual smoke test

1. Build and launch Surffish. Open **Settings → Integrations → Bramble password manager** and choose **Check for updates**; confirm the version/status is shown.
2. Click **Install**. Review the native confirmation’s version, digest statement, and permissions; choose **Cancel** and verify the install state stays unchanged. Repeat and choose **Install Bramble**.
3. Confirm Integrations shows the installed version and effective site/API permissions. Use the Bramble toolbar icon; confirm it opens the 500×550 compact popup anchored beneath the icon and dismisses on outside focus or Escape.
4. Choose **Setup / customize** in Integrations. Confirm Bramble’s options/setup page opens in a separate resizable window. Create a disposable local vault and verify it can be locked and unlocked from the popup.
5. With the app offline, restart Surffish and confirm the already installed extension still loads from the locally retained archive. Reconnect, use **Check for updates**, and confirm the Settings status/error is informative.
6. For an update test, use an upstream release newer than the installed version. Cancel at the permission prompt once; verify the old popup and vault remain usable. Then confirm the update; verify the new version is shown and the prior vault is still present.

## Automated checks

```sh
cd /path/to/Surffish
npm test
npm run typecheck
npm run build
```

The unit suite includes Bramble release selection, URL allow-list, GitHub/SHA256SUMS digest verification, ZIP extraction, and path-traversal rejection. The existing adapter tests verify the Firefox build adaptation and the existing UI/bridge smoke harness remains available:

```sh
npm run test:bramble-poc -- /path/to/bramble/packages/platform-extension/dist-firefox
npm run test:bramble-app-poc -- /path/to/bramble/packages/platform-extension/dist-firefox
xvfb-run -a npm run test:electron-extensions
xvfb-run -a npm run test:electron-host-bridge
```

Those two Bramble app-probe commands need a built upstream `dist-firefox` folder because they exercise the existing app integration against local source. That is a maintainer/test requirement only; normal Surffish users install from the GitHub release in Settings.

The app-level smoke harness uses a temporary profile and local-only test sites. It verifies vault create/lock/unlock, one conventional localhost password autofill flow, an opt-in localhost ES256 WebAuthn registration/assertion, the Join form without completing pairing, and encrypted backup restore without overwriting existing vault bytes. It does not verify live pairing/sync, every site’s autofill behavior, public relying parties, or a signed Bramble package.

## Upstream references

- [Bramble source and releases](https://github.com/flythenimbus/bramble)
- [Bramble Firefox 1.28.0 release](https://github.com/flythenimbus/bramble/releases/tag/1.28.0-firefox)
- [Bramble Firefox release workflow](https://github.com/flythenimbus/bramble/blob/main/.github/workflows/firefox-release.yml)
- [Bramble release verification workflow](https://github.com/flythenimbus/bramble/blob/main/.github/workflows/release.yml)
- [Electron extension API](https://www.electronjs.org/docs/latest/api/extensions)
