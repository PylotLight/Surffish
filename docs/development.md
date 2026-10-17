# Development and technical notes

This page collects setup and implementation details for contributors. Feature behavior lives in the code and its tests; this page covers setup, testing and the non-obvious bits.

## Local development

Use Bun from the repository root:

```bash
bun run dev
bun run typecheck
bun run test
bun run build
```

`bun run dev` installs dependencies on first start and when the dependency manifests change, and cleans up the terminal on exit (`bun run dev:bare` is plain `electron-vite dev`). `bun run start` launches the built app from `out/`; `bun run clean` removes `out/`. To run the native sidebar-overlay integration check on Linux with a virtual display:

```bash
xvfb-run -a bun run test:electron-sidebar-overlay
```

Set `SURFFISH_SCREENSHOT_DIR=/path/to/output` to have that test save full-window Electron captures for review.

## README screenshots

`scripts/readme-screenshots.cjs` (`bun run screenshots:readme` after `bun run build`) opens a throwaway profile, sets up each README scene (sidebar tabs, palette, split view, reader, Back history menu, proxy settings, New Tab) on real public sites, and writes one PNG per scene to `SURFFISH_SCREENSHOT_DIR`. A site that doesn't load in time is swapped for a local fixture page. `README_SHOTS=hero,palette` runs a subset.

- **Linux:** run it under Xvfb (`xvfb-run -a bun run screenshots:readme`); it grabs the window with ffmpeg's x11grab.
- **macOS:** the manual **readme screenshots** workflow (Actions → readme screenshots → Run workflow, pick the branch) runs it on the self-hosted Mac and commits the PNGs to `docs/screenshots/mac/` on that branch. The window is shown on screen while it runs. With Screen Recording permission for the runner it uses `screencapture -l` (native sidebar blur); without it, it stitches the window's views with `capturePage` and switches the sidebar to the snapshot blur. `capture-method.txt` records which one ran.

The README uses resized WebP copies in `docs/assets/` (`magick in.png -resize 1600x -quality 80 out.webp`); delete the raw PNGs before merging.

## Architecture

Surffish is an Electron desktop browser with a React renderer. The main process owns the browser session, tabs, site permissions, network filtering, and persisted preferences. Trusted local UI surfaces use context isolation and a restricted preload API; remote pages run in separate `WebContentsView`s.

The browser page keeps full-window bounds when the glass sidebar is open. The sidebar is a separate native overlay with a width-controlled hit-test region. During a drag, its native view temporarily expands so pointer capture continues past the moving edge; after release, the view bounds return to the saved width. The integration smoke test checks click-through outside the panel, edge reveal/hide, actual mouse input, width persistence, and tab lifecycle.

## Browser engine and integrations

The desktop app embeds Chromium/Blink through Electron. Electron extension support is partial and loads unpacked extensions; consult the [official compatibility list](https://www.electronjs.org/docs/latest/api/extensions) before relying on a specific extension. Bramble is a tested integration for its existing password-fill flow, not a general extension store. Its custom-RP-ID passkey flow has additional runtime, relying-party, and host-permission requirements. Native macOS Touch ID for arbitrary website passkeys requires Apple's managed browser credential entitlement, app signing, and review; it is separate from an extension's own vault unlock.

Network filtering uses uBlock Origin filter lists through `@ghostery/adblocker-electron`, including network, cosmetic, and scriptlet rules. A dedicated persistent Chromium session can use an optional local SOCKS5 proxy; it affects this browser session only. The saved proxy choice is off for fresh profiles. Surffish is not an audited privacy browser and does not promise DNS or WebRTC leak protection.

## Electron smoke tests

Every `scripts/electron-*-smoke.cjs` (and the perf / extension probes) requires `scripts/smoke-harness.cjs` first. It:

- Fails a stuck smoke instead of letting it hang: a hard overall limit of `SMOKE_TIMEOUT_MS` (default 4 × `SMOKE_WAIT_MS`, at least 4 minutes; 6 minutes in CI) exits with code 124, the last line the smoke printed, and the open windows and views. Child phases (e.g. the multi-window relaunch) are killed with it.
- Seeds the adblock engine under the app's real cache name and filter config (`scripts/smoke-adblock-config.cjs`, kept in sync by a unit test), so smokes never download the real filter lists at launch.
- On Linux with the sandbox off (`ELECTRON_DISABLE_SANDBOX=1` / `--no-sandbox`), adds `--no-zygote` (`scripts/smoke-chromium-args.cjs`; `SMOKE_KEEP_ZYGOTE=1` turns it off). The app itself never gets it. Zygote-forked renderers are non-dumpable, so their `/proc/<pid>/oom_score_adj` is root-owned and the browser logs `Failed to adjust OOM score of renderer … Permission denied (13)` for every renderer. Without a zygote, renderers are launched directly and no write is attempted. Chromium only allows this when the sandbox is off.

The k3s runner has passwordless sudo, so CI runs sandboxed. Chromium picks the user-namespace sandbox there and the OOM-score line still shows up for each renderer. It's harmless. Routing the write through the setuid `chrome-sandbox` helper (`--disable-namespace-sandbox`) doesn't work in the pod: the setuid sandbox can't create its PID namespace ("Failed to move to new namespace … Operation not permitted"). Adding capabilities to the pod securityContext doesn't help either, because the runner isn't root.

## Feature smokes and probes

Each feature has a `test:electron-<feature>` script in `package.json` (feeds, reading-list, spaces, tab-groups, downloads, adblock, extension-dnr, …). Run it after `bun run build`, under `xvfb-run -a` on Linux. Smokes that hit the real web (`test:electron-youtube`, `test:electron-adblock-sites`) write JSON and screenshots to `adblock-harness-output/`; `SURFFISH_HARNESS_PROXY` routes them through a SOCKS proxy.

- Web Store extensions: `bun run probe:web-store-extension modern-for-hn|i-still-dont-care-about-cookies [out-dir] [--probe]` downloads, verifies and stages one as Surffish would; `bun run probe:electron-extension-real -- <unpacked-dir>` loads one unmodified and reports what fails; `bun run check:password-extension -- bitwarden|bramble <unpacked-dir>` statically lists APIs Electron lacks; `bun run bench:dnr [rules.json]` times the DNR matcher. `SURFFISH_DNR_SMOKE_EXTENSION=<staged dir>` runs `test:electron-extension-dnr` against a real extension.
- Bramble: `bun run check:bramble-quick-unlock <bramble_firefox_X>` (and `scripts/check-bramble-quick-unlock-app.cjs`, `check-bramble-focus-existing-tab-app.cjs`, `check-bramble-tabs-create-app.cjs` against the built app) need an unpacked upstream Firefox build; they are not in CI.
- Tuning knobs: `SURFFISH_SIDEBAR_MOTION=stepped|native|off` (sidebar slide; `native` is experimental on macOS), `SURFFISH_DEBUG_SIDEBAR=1` (logs why the auto-hide sidebar is held open and what released it, to stderr and `sidebar-lock.log` in the app's logs folder, `~/Library/Logs/Surffish` on macOS), `SURFFISH_SIDEBAR_CURSOR_POLL=off` (no cursor-poll fallback for a missed mouseleave), `SURFFISH_SWIPE_INTENT="minDistance=8,minRatio=1.8,minVelocity=0.06"` and `SURFFISH_SWIPE_DEBUG=1` (trackpad back/forward swipe), `SURFFISH_STORE=json` (skip `surffish.db`), `SURFFISH_DEBUG_STALLS=1` (Debug logging for this run: main-thread stalls, crashes and a heartbeat to `stalls.log` in the app's logs folder; see [troubleshooting](troubleshooting.md)).

## Electron gotchas

- Electron allows one listener per `webRequest` event per session. `src/main/adblock-engine.ts` owns it; anything else (kill switch, HTTPS-only, extension DNR) plugs in as a request gate rather than registering its own.
- Electron's native `declarativeNetRequest` enforces nothing while the session has a `webRequest` listener, so Surffish matches DNR rules itself (`src/shared/dnr.ts`, `src/main/extension-dnr.ts`).
- Electron 44 never delivers `chrome.storage.onChanged` to an MV3 service worker; the Bramble shim relays local-area changes from Bramble's offscreen page.
- Electron's `tabs.query`/`tabs.create`, `storage.sync`, `webNavigation` and `management` don't work for extensions; Surffish shims them in extension contexts (`src/main/web-store-extension-adapter.ts` and the `extension-host`/`extension-bridge` preloads). The extension-page `chrome.tabs` shim (`extension-tabs-shim.ts`, served by `extension-tabs-host.ts`) is shared by Web Store extensions and Bramble's popup/tabs.

## Further technical references

- [Architecture](architecture.md)
- [Profile storage (surffish.db)](storage.md)
- [Perf check and CI](perf.md)
- [macOS builds and releases](releasing.md)
- [Troubleshooting](troubleshooting.md)
- [Third-party assets and licenses](third-party-assets.md)
