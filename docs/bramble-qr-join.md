# Bramble: Scan QR on Join a device

Surffish-only. Bramble's extension build only takes a pasted pairing code (its `cameraScan` capability is off outside mobile), while the phone app's **Add a device** screen shows the code as a QR. Surffish adds a **Scan QR** button to Bramble's **Join a device** form (`options.html`) and fills the pairing code from the webcam. Bramble and its apps are never patched.

## Pairing code format

From `flythenimbus/bramble` `packages/core/src/sync/enrollment.ts`: `bramble-pair-1.` followed by base64 of JSON `{ v: 1, groupKey, inviterPub, psk, relay, iceUrl?, exp? }`. The Add a device screen encodes exactly that string as the QR (`QRCodeSVG value={pairingCode}`). The scanner also unwraps the code from a URL or deep link (query, fragment or path, percent-encoded, base64url) in case a future version wraps it, and refuses QRs that aren't a v1 pairing payload (it keeps scanning with a hint).

## How it fits together

- `src/shared/bramble-qr-join-page.cjs`: the page script. Staged into Bramble's folder as `surffish-bramble-qr-join.js` with one `<script defer>` tag in `options.html` (`addBrambleQrJoin` in `bramble-poc-adapter.ts`, run on every stage and on a saved staged build). A MutationObserver keeps the button under `textarea#pairing-code` (or the "Add a device" placeholder) across React re-renders.
- Camera: `getUserMedia` video only (ideal 1920x1080, `facingMode: environment`, any camera as fallback), preview mirrored with CSS, frames decoded unmirrored. `BarcodeDetector` when Chromium can read QR (macOS), else jsQR (`surffish-jsqr.js`, loaded on first use). Cancel / Esc / leaving the page stops the camera.
- Fill: the native `HTMLTextAreaElement.prototype.value` setter plus `input` and `change` events, so React's controlled field sees a real change (Bramble's UI is React 19). Focus then moves to the master password.
- **Scan password QR** under the master password field fills it from a plain-text QR the same way. The value only goes into Bramble's field: nothing is logged, stored or sent.
- Permissions (`proxy.ts` → `bramble-camera-permission.ts`, rule in `src/shared/bramble-camera.ts`): `media` from the loaded Bramble extension's own pages is allowed for video only; on macOS `systemPreferences.askForMediaAccess('camera')` runs first (needs `NSCameraUsageDescription`, set in `package.json` `build.mac.extendInfo`). A microphone request or a macOS denial is refused and shows the usual permission toast. Other sites are unchanged.

## Closing the setup tab when setup is done

`src/shared/bramble-setup-close-page.cjs` rides in the same staged script. Bramble 1.29's `SetupShell` (`packages/core/src/app/OptionsApp.tsx`) ends every successful create (after the recovery code screen's Continue), join (after "Connecting to your other device…") and restore on a terminal done screen: a `svg.lucide-check`, an h1 ("Vault ready" / "Vault unlocked" / "Vault added") and no buttons or fields. Each of those also writes a new vault (a new `vault.registry` id with a non-empty `vault-blob-b64:<id>`).

- The page snapshots which vaults have a blob when `options.html` loads (no `?screen=`), and asks to close only when the done screen is showing (matched by shape, so any locale) and a vault exists that wasn't there at load. 1.5 s later, if the done screen is still up, it calls `surffishBramble.closeSetupTab()` (preload `bramble-poc.cjs` → `browser:bramble:setup-done`).
- Main (`closeBrambleSetupTab` in `bramble-poc.ts`) re-checks: main frame of a Bramble tab, `options.html` without `?screen=` (`isBrambleSetupPageUrl`), and Bramble really has a vault (the quick unlock probe). Then `closeTabKeepingWindow` in `browser.ts`: the last tab of a window is swapped for a New Tab first (`planSetupTabClose`), so finishing setup never closes a window.
- Never closes on errors, on the connecting or recovery code screens, on `?screen=import|restore`, or when `options.html` is opened on an existing vault and left there.

## Checks

- Unit: `src/shared/bramble-qr-join.test.ts` (code extraction, password QR), `src/shared/bramble-setup-close.test.ts` (setup tab close rules), `src/shared/bramble-camera.test.ts` (permission rule), `src/main/bramble-poc-adapter.test.ts` (staging).
- Smoke (CI, Linux): `bun run build && xvfb-run -a bun run test:electron-bramble-qr-join`: a fixture copy of the Join form with a React-style value tracker and a mocked camera, then a tiny extension page on Chromium's fake camera fed a QR video, then the setup tab auto-close against real `chrome.storage.local` with Bramble's screens copied (phase 3).
- Real Bramble (not in CI): `bun run build && xvfb-run -a electron --no-sandbox scripts/check-bramble-qr-join.cjs <unpacked bramble_firefox_X>` (Bramble's React form takes the scanned code), and `scripts/check-bramble-qr-join-app.cjs <dir>` (the built app: staging, Surffish's own permission policy gives video and refuses the microphone), and `scripts/check-bramble-setup-close-app.cjs <dir>` (the built app creates a vault in real Bramble with the setup tab as the only tab: it closes ~1.5 s after Vault ready and a New Tab takes its place; an options tab on an existing vault stays).
- Needs a Mac check: the camera permission prompt and a real phone QR.
