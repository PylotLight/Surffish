# Bramble Firefox-build POC

This is an **opt-in, Bramble-only proof of concept** in Sockfish. It does not add general Firefox/Chrome extension compatibility or a general extension manager.

## Verified in Sockfish

Against Bramble **1.28.0**'s Firefox build, the automated app-level test now verifies:

- Bramble's actual first-run popup and vault-setup UI render inside Sockfish; clicking **Create your vault** opens the separate Setup/Restore window.
- A disposable local vault can be created, explicitly locked, and unlocked with the master password.
- Bramble's Firefox MAIN-world WebAuthn bridge is injected into a Sockfish browser tab.
- Bramble's real consent card approves a passkey registration for a localhost relying party; a subsequent `navigator.credentials.get()` signs in with that stored passkey.
- The returned signature verifies against the public key from registration. The test also checks the RP ID hash, origin, challenge, user-presence, and user-verification flags.
- The **Join a device** form renders its pairing-code and master-password fields; the test does not create a code or connect another device.
- Actual page-based password autofill works on a local-only login form: the test creates a synthetic login through Bramble's real editor, checks the content-script query, selects the visible matching suggestion, and verifies both username and password fields before a local submit handler accepts them. No form request leaves the localhost harness.
- A full encrypted `.bramble` backup restores through Bramble's **Setup/Restore → Restore from backup** UI. When a vault already exists, the restore adds a second locked vault and the first vault's encrypted bytes remain unchanged.

The automated test uses a temporary Sockfish profile, random in-memory vault and login credentials, a local-only autofill form, and a localhost relying party. It blocks non-local DNS, does not log or fixture the test credentials or private key, prevents any form POST from leaving the local harness, and removes the temporary profile after the run. The screenshot is `/workspace/bramble-poc-verification.png` by default.

## Bring an existing vault into Sockfish

There are two different routes: **Restore from backup** makes a one-time copy; **Join a device** enrolls Sockfish into the live sync group.

### One-time encrypted backup restore

1. In the Bramble app or browser where the vault currently lives, create a fresh **Settings → Data → Export a backup** `.bramble` file and keep that backup unchanged somewhere safe.
2. In Sockfish, open **Bramble → Setup/Restore**, choose **Restore from backup**, and select the `.bramble` file.
3. Enter the backup's master password directly in Bramble's restore screen; do not send it in chat or put it in a URL/command.
4. If Sockfish already has a vault, Bramble adds the backup as a separate, locked vault and leaves the existing vault untouched. Open it from Bramble's vault picker and unlock it yourself.

This is a snapshot restore, not sync enrollment. If the Sockfish profile has no vault yet, the backup becomes its first vault instead.

### Live device sync

1. On the existing Bramble device, unlock the source vault and open **Settings → Sync → Add a device** to generate a pairing code.
2. In Sockfish, open **Bramble → Setup/Restore → Join a device**, paste the code into Bramble's form, and enter the source vault's master password there.
3. Keep both devices online and open through enrollment. Compare the safety code shown on both devices; approve on the existing device only if the codes match exactly. If they differ, reject and generate a new pairing code.

**Treat the pairing code as a vault secret:** it is single-use, expires after about three minutes, and anyone who completes pairing receives the vault. Initial enrollment transfers the vault; ongoing sync requires both devices online and their vaults unlocked at the same time. You must personally enter the pairing code and password and approve the matching safety code for your actual vault. The POC test did not use or access a real vault.

## What the POC adds

- A **Bramble** toolbar launcher that opens a compact popup directly below its button, plus a separate **Setup/Restore** action. The popup dismisses on outside focus or Escape; its first-run **Create your vault** action opens the app-owned options window. First use selects an unpacked Bramble Firefox build, shows its broad `<all_urls>` host access, and requires an explicit in-app confirmation.
- A document-sized, resizable Setup/Restore window with native window controls and scrolling when the Bramble options page exceeds the available display. The Join route now fits at 680 CSS px when the display allows it, with scroll fallback on smaller displays. The popup stays at Bramble's 500×550 CSS viewport and is scrollable on smaller displays.
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
2. Click **Bramble**, select Bramble's unpacked `dist-firefox` folder, and review/accept the host-access warning. Bramble opens in a compact popup directly below its toolbar button.
3. Click **Create your vault** in the first-run popup to open Bramble's actual options page in Sockfish's separate Setup/Restore window. The POC routes this action through a narrow app-owned bridge because Electron's `runtime.openOptionsPage()` route is unreliable here. The Setup toolbar action remains available whenever you need to reopen the options page.
4. Create a disposable vault there, then close and reopen the Bramble popup to check the vault can unlock. The popup dismisses when it loses focus or you press Escape.
5. In Bramble **Settings**, enable **Use Bramble for passkeys**. This is opt-in and off by default because it handles browser WebAuthn prompts.
6. Run the automated smoke command below for a local passkey registration and assertion. It opens no external relying party and needs no existing vault or account.

The app-level test covers a new local vault, lock/unlock, selected password autofill into a conventional localhost username/current-password form, passkey registration/assertion, the Join form, and a full encrypted backup restore into the same disposable profile. It confirms that the restore creates a second locked vault and preserves the original encrypted bytes. It does not exercise live pairing/sync or the portable item-import pipeline. The POC leaves vault data in Bramble's extension-owned storage; Sockfish does not read or log the master password. OAuth backup is unsupported in this Electron adaptation because the Firefox build's `identity` permission is removed.

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

`test:bramble-poc` stages the Firefox build with the production adapter and runs a network-isolated Electron extension/UI/bridge probe. `test:bramble-app-poc` launches the built Sockfish app with a temporary profile, verifies the Join form without sending a code, creates and unlocks a disposable vault, adds one synthetic login through Bramble's real editor, confirms the page content script receives the matching local-host query, selects the visible suggestion, and verifies a prevented local form submission with both fields populated. It then enables Bramble's provider in that test profile, performs and verifies the consented localhost create/get ceremony, restores a full encrypted backup as a second locked vault, and checks that the original encrypted bytes are unchanged. It cleans up its temporary profile. Both app probes use Xvfb automatically on headless Linux.

The test-only variables `SOCKFISH_BRAMBLE_POC_DEV_AUTOLOAD=1` and `SOCKFISH_BRAMBLE_EXTENSION_DIR=...` bypass the folder picker/confirmation **only in an unpackaged development build**. Do not set them for normal use or packaging.

## Boundaries and known gaps

- This is an adapter for Bramble's Firefox build, not a general extension loader. Sockfish still has no general extension list, permission revocation, extension settings manager, or general toolbar-popup framework; its compact launcher and app-owned Setup/Restore route are Bramble-specific.
- The extension requests `<all_urls>`; its scripts can run on matching sites. Treat the host-access confirmation as meaningful, and leave Bramble's passkey provider off unless you intend it to handle passkey prompts.
- Full encrypted `.bramble` restore is verified only on a disposable vault copy, including the non-overwrite behavior when a vault already exists. Portable item import and third-party imports are not tested.
- The Join form is verified, but actual device pairing and ongoing P2P sync have not been tested in Sockfish; no real pairing code or vault was used. Do not treat sync as verified until a separate two-disposable-profile pairing test passes. OAuth backup is unsupported here, and other cloud backup destinations are unvalidated.
- The automated WebAuthn test covers an isolated `localhost` RP and ES256 create/get, not arbitrary public sites, every WebAuthn option, cross-origin iframe behavior, or production packaging/signing. The provider continues to use Bramble's Firefox MAIN-world bridge because Electron does not expose `webAuthenticationProxy`.
- Password autofill is verified for one conventional, local-only username/current-password form. This does not establish compatibility with all sites, complex forms, shadow DOM, cross-origin frames, or other password managers; the POC does not change Bitwarden or other extension support.
- The extension's vault data remains in Sockfish's persistent browser profile even if the selected build directory moves or is removed. Use Bramble's own vault-management UI to remove a vault.
- No Bramble source/build output, WASM, real vault credentials, recovery codes, or test vault fixtures are committed.

## Upstream references

- [Bramble source](https://github.com/flythenimbus/bramble)
- [Bramble P2P sync and pairing design](https://github.com/flythenimbus/bramble/blob/main/docs/p2p-sync.md)
- [Bramble multi-vault and restore behavior](https://github.com/flythenimbus/bramble/blob/main/docs/multiple-vaults.md)
- [Bramble Firefox-port notes](https://github.com/flythenimbus/bramble/blob/main/docs/firefox-port.md)
- [Firefox WebAuthn MAIN-world bridge](https://github.com/flythenimbus/bramble/blob/main/packages/platform-extension/src/content/webauthn-inpage.ts)
- [Firefox isolated-content-script relay](https://github.com/flythenimbus/bramble/blob/main/packages/platform-extension/src/content/webauthn-bridge.ts)
- [Passkey provider flow](https://github.com/flythenimbus/bramble/blob/main/packages/platform-extension/src/background/webauthn-proxy.ts)
- [Electron extension API](https://www.electronjs.org/docs/latest/api/extensions)
