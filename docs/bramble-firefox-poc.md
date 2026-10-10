# Bramble Firefox-build POC

This is an **opt-in, Bramble-only proof of concept** in Sockfish. It does not add general Firefox/Chrome extension compatibility or a general extension manager.

## Verified in Sockfish

Against Bramble **1.28.0**'s Firefox build, the automated app-level test now verifies:

- Bramble's actual first-run popup and vault-setup UI render inside Sockfish.
- A disposable local vault can be created, explicitly locked, and unlocked with the master password.
- Bramble's Firefox MAIN-world WebAuthn bridge is injected into a Sockfish browser tab.
- Bramble's real consent card approves a passkey registration for a localhost relying party; a subsequent `navigator.credentials.get()` signs in with that stored passkey.
- The returned signature verifies against the public key from registration. The test also checks the RP ID hash, origin, challenge, user-presence, and user-verification flags.

The automated test uses a temporary Sockfish profile, a random in-memory test password and user handle, and a local-only relying party. It blocks non-local DNS, writes no test credentials or private key to logs or fixtures, and removes the temporary profile after the run. The screenshot is `/workspace/bramble-poc-verification.png` by default.

## What the POC adds

- A **Bramble** toolbar launcher and a separate **Setup/Restore** action in Sockfish. First use selects an unpacked Bramble Firefox build, shows its broad `<all_urls>` host access, and requires an explicit in-app confirmation.
- A narrow adapter for Bramble's known Firefox Manifest V3 package. It stages a private copy under Sockfish's user-data folder, adapts its module background entry and `browser` namespace, and does not modify the source build.
- Bramble's real popup/options UI and an app-owned hidden `offscreen.html` host in the same browser session. The offscreen host is needed for Bramble's actual vault crypto path.
- A remembered source-build path for opt-in reload at Sockfish startup. Rebuild Bramble and the staged copy is refreshed on app startup.

## Build Bramble locally

Use Bramble's upstream source; its generated WASM crypto is needed for vault creation/unlock:

```sh
cd /path/to/bramble
pnpm install --frozen-lockfile
cargo install wasm-pack --locked --version 0.13.1
pnpm run wasm:build
pnpm run build:firefox
```

Select `packages/platform-extension/dist-firefox` in Sockfish. Bramble source, generated bundles, and WASM are not vendored in this repository.

## Manual in-app test

1. Build Sockfish and Bramble as above, then start Sockfish from this branch.
2. Click **Bramble**, select Bramble's unpacked `dist-firefox` folder, and review/accept the host-access warning.
3. Click Sockfish's **Setup/Restore** toolbar action to open Bramble's actual options page. Create a disposable vault there, then close and reopen the Bramble window to check the vault can unlock. Use this app-owned route for setup because Electron's `runtime.openOptionsPage()` link from Bramble's first-run popup is not a reliable navigation path here.
4. In Bramble **Settings**, enable **Use Bramble for passkeys**. This is opt-in and off by default because it handles browser WebAuthn prompts.
5. Run the automated smoke command below for a local passkey registration and assertion. It opens no external relying party and needs no existing vault or account.

The smoke test covers a new local vault, lock/unlock, passkey registration, and assertion. Bramble's restore/import options are visible but have not been validated. The POC leaves vault data in Bramble's extension-owned storage; Sockfish does not read or log the master password. Bramble's optional Google Drive/OAuth backup is unsupported in this Electron adaptation because the Firefox build's `identity` permission is removed.

## Validation commands

```sh
cd /path/to/Sockfish
npm test
npm run typecheck
npm run build
npm run test:bramble-poc -- /path/to/bramble/packages/platform-extension/dist-firefox
npm run test:bramble-app-poc -- /path/to/bramble/packages/platform-extension/dist-firefox
xvfb-run -a npm run test:electron-extensions
xvfb-run -a npm run test:electron-host-bridge
```

`test:bramble-poc` stages the Firefox build with the production adapter and runs a network-isolated Electron extension/UI/bridge probe. `test:bramble-app-poc` launches the built Sockfish app with a temporary profile, creates and unlocks a disposable vault, enables Bramble's provider in that test profile, then performs the consented localhost create/get ceremony and verifies the assertion cryptographically. It cleans up its temporary profile. Both app probes use Xvfb automatically on headless Linux.

The test-only variables `SOCKFISH_BRAMBLE_POC_DEV_AUTOLOAD=1` and `SOCKFISH_BRAMBLE_EXTENSION_DIR=...` bypass the folder picker/confirmation **only in an unpackaged development build**. Do not set them for normal use or packaging.

## Boundaries and known gaps

- This is an adapter for Bramble's Firefox build, not a general extension loader. Sockfish still has no general extension list, permission revocation, extension settings manager, or compatible toolbar-popup framework.
- The extension requests `<all_urls>`; its scripts can run on matching sites. Treat the host-access confirmation as meaningful, and leave Bramble's passkey provider off unless you intend it to handle passkey prompts.
- OAuth/Google Drive backup is unsupported; new local vault setup, lock, unlock, passkey registration, and passkey assertion were verified. Restore/import paths remain untested.
- The automated WebAuthn test covers an isolated `localhost` RP and ES256 create/get, not arbitrary public sites, every WebAuthn option, cross-origin iframe behavior, or production packaging/signing. The provider continues to use Bramble's Firefox MAIN-world bridge because Electron does not expose `webAuthenticationProxy`.
- This POC does not change Bitwarden or other extension support and makes no claim of general password autofill compatibility.
- The extension's vault data remains in Sockfish's persistent browser profile even if the selected build directory moves or is removed. Use Bramble's own vault-management UI to remove a vault.
- No Bramble source/build output, WASM, real vault credentials, recovery codes, or test vault fixtures are committed.

## Upstream references

- [Bramble source](https://github.com/flythenimbus/bramble)
- [Bramble Firefox-port notes](https://github.com/flythenimbus/bramble/blob/main/docs/firefox-port.md)
- [Firefox WebAuthn MAIN-world bridge](https://github.com/flythenimbus/bramble/blob/main/packages/platform-extension/src/content/webauthn-inpage.ts)
- [Firefox isolated-content-script relay](https://github.com/flythenimbus/bramble/blob/main/packages/platform-extension/src/content/webauthn-bridge.ts)
- [Passkey provider flow](https://github.com/flythenimbus/bramble/blob/main/packages/platform-extension/src/background/webauthn-proxy.ts)
- [Electron extension API](https://www.electronjs.org/docs/latest/api/extensions)
