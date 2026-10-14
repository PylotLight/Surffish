# Architecture

Surffish uses a trusted Electron main process, a native `BaseWindow` view tree, three small local React renderer surfaces, and an isolated remote `WebContentsView` for each loaded tab. The active site page is a full-width native view underneath the app chrome. On live sites, transparent toolbar and glass-sidebar surfaces are placed above it; on the local New Tab and full-app panels, the original full React surface is shown instead. New background tabs remain URL-only until selected; restored tabs remain unloaded until explicitly resumed. Loaded tabs continue playing media when inactive, and optional hibernation releases inactive, non-audible views for reuse later.

```text
                     ┌── local full-app renderer (New Tab, settings, full panels)
BaseWindow view tree ├── transparent toolbar renderer (live-site overlay)
                     ├── glass sidebar renderer (zero-width hidden / user-sized overlay)
                     └── per-tab remote WebContentsViews (full-width page, lower layer)
                                      │
                                      └── shared persistent SOCKS5 browser session
```

- `src/main/index.ts` — application startup; restores protected session cookies and configures the browser proxy before creating tabs.
- `src/main/window.ts` — native `BaseWindow` lifecycle, platform chrome, trusted local renderer views, and local renderer loading.
- `src/main/browser-shell.ts` — native view ordering/visibility, measured toolbar geometry, hover/pin state synchronization, and the local-renderer allowlist.
- Persisted browser preferences are read as one snapshot and broadcast to all three local surfaces, keeping pins and the selected search engine coherent when the visible renderer changes.
- `src/main/browser.ts` — lazy per-tab page views, configurable tab hibernation, active-tab switching, full-width page bounds, navigation, and restoration of the last open tabs.
- `src/main/network-inspector.ts` — opt-in per-tab Chromium DevTools Protocol Network capture, a 1,000-request in-memory ring, and on-demand request/response detail lookup.
- `src/main/deferred-writes.ts` — coalesces hot-path writes (session tabs, history, favicon cache, downloads) and flushes them on quit, before `surffish.db` closes. New frequently-updated stores should go through `deferWrite`.
- `src/main/store/` — the profile's SQLite database (`surffish.db`) for history, the window/tab session, bookmarks, preferences and Spaces, with JSON files kept as fallback copies; see [Profile storage](storage.md).
- `src/main/browser-persistence.ts` — open windows/tabs, active tab, and browser preferences (tab-sleep interval, site settings, zoom), saved through `src/main/store/` with the JSON fallback.
- `src/main/session-cookies.ts` — encrypted snapshot/restore of session-only cookies using Electron safeStorage when OS-backed encryption is available.
- `src/main/history.ts` — validated, bounded browsing history, stored in `surffish.db` (falls back to `browsing-history.json`).
- `src/main/proxy.ts` — validates loopback-only SOCKS5 settings, persists them, and configures the persistent site session.
- `src/main/ipc.ts` — browser IPC guarded to the three trusted local renderer views; toolbar geometry reports are accepted only from the toolbar surface.
- `src/preload/index.ts` — narrow, typed browser API exposed through `contextBridge` to the local renderers only.
- `src/shared/navigation.ts` — HTTP(S)-only address parsing and selected-search-engine routing.
- `src/shared/types.ts` — browser, proxy, chrome-state, and toolbar-metrics contracts shared across processes.
- `src/renderer/` — shared React UI rendered as the full app, toolbar-only, or sidebar-only surface according to a trusted URL query parameter.
  - `views/Browser.tsx` — the shell (toolbar, sidebar, New Tab, settings pages). Every surface mounts it, so effects that fetch or subscribe should be gated by `surface` / visibility.
  - `views/NetworkView.tsx`, `DownloadsPanel.tsx`, `ExtensionToolbarButtons.tsx`, `ExtensionsSettings.tsx`, `TabIndicators.tsx` — self-contained features that own their own state; prefer adding new features as files like these instead of growing `Browser.tsx`.
  - `views/settings/SettingsControls.tsx` — `SettingsGroup` / `SettingsRow` / `SettingsSlider` primitives for settings pages.
  - `lib/` — renderer helpers (`stored-state.ts` for small cross-surface localStorage prefs, `format.ts`).
  - Toolbar-surface popups must size in px, not `vh`: the toolbar view is only toolbar-tall until the popup's measured bottom grows it.

## Security and input boundaries

1. Remote content is never loaded into the React renderers. Site `WebContentsView`s use `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`, and `webSecurity: true`; they receive no Surffish preload bridge.
2. Remote tabs use Surffish's persistent `persist:surffish-browser` session, which stores site cookies/storage and uses the configured SOCKS5 proxy.
3. Local UI IPC is accepted only from the content, toolbar, or sidebar WebContentsViews created by `window.ts`. Remote site pages cannot call those handlers.
4. Native stacking places the live page below the transparent local surfaces. The full React content surface is made invisible while a web page is active, so its full-window hit-test rectangle cannot intercept site clicks or scrolling. The toolbar and sidebar remain bounded overlays; while hidden, the sidebar has zero native width and the page's own mouse-move events reveal it after a short hover delay without reserving or blocking a pixel.
5. Non-HTTP(S) navigations, unapproved popups, and web permission requests retain their existing blocking policy. SOCKS settings accept loopback hosts only.

## Private tabs

`New Private Tab` (⌘/Ctrl+Shift+N, or the mask button next to New Tab in the sidebar) opens a tab in `surffish-private`, an in-memory partition created lazily by `getPrivateSession()` in `src/main/browser-session.ts`. Modules that configure page sessions register with `onPrivateSessionCreated` (proxy + permission policy, ad blocking, downloads); private pages wait on `whenPrivateSessionReady()` so nothing loads before the SOCKS proxy is applied, and a failed setup blocks the load instead of going direct. Private tabs are excluded from the saved session, history, favicon cache, recently-closed list, extension `chrome.tabs` APIs and the Google WebKit sign-in hand-off; their downloads are listed for the session but never written to download history. Closing the last private tab clears the partition's storage, cache, auth and host caches. Web Store extensions and Bramble are not loaded into the private session.

## Glance (link peek)

Shift+click a link (or right-click → **Open Link in Glance**, or ⌘K → **Open Copied Link in Glance**) and it opens in a floating sheet over the current tab instead of a new tab. Settings → General → Glance turns the Shift+click part off; then Shift+click behaves as before (Chromium's `new-window` disposition, still blocked unless the site allows popups as tabs). A Shift+clicked link is told apart from a script popup by its disposition (`new-window`) with no size features (`isShiftClickLinkOpen` in `src/shared/glance.ts`).

- `src/main/glance-entry.ts` is all main loads at startup: the setting, IPC, and the hooks browser.ts calls. `src/main/glance.ts` (the sheet) is a lazy chunk imported on the first open, so Glance costs nothing at launch.
- One glance per window, two views added on top of everything in the window: a transparent local view (`glance-page.ts`, preload `glance.cjs`) that draws the dimmed backdrop, the rounded card and its header (title/URL, Back, Split View, Open as Tab, Close), and the page itself, a `WebContentsView` with a tab's webPreferences in the **source tab's session**, so private tabs, Spaces and per-site proxy rules apply unchanged. The header view is loaded before it is attached, so it never takes keyboard focus from the page.
- Esc, ⌘/Ctrl+W or a press on the backdrop close it and destroy both webContents. Any other browser shortcut (⌘T, ⌘K, ⌘L…) closes the glance first and then runs. The glance also closes when its tab leaves the screen (tab switch, tab closed) or the window closes.
- ⌘/Ctrl+Enter (or **Open as Tab**) promotes it: the page's own view becomes a new tab right after the source tab, so nothing reloads and back/forward history is kept. **Split View** does the same and shows the new tab in a split next to the source. (A webContents can't be handed to a second `WebContentsView`; trying hangs main, so the tab takes over the view itself.)
- Links inside navigate within the glance (plain clicks, `target=_blank` and Shift+click); ⌘/Ctrl+click still opens a background tab. Visits go to history like a tab's, except from private tabs.
- Diagnostics lists an open glance (`Glance: host`). `onGlanceLinkHover` / `openGlance` in `glance-entry.ts` are the hooks for a later preconnect-on-hover pass; nothing listens yet.
- Coverage: `test:electron-glance` (real Shift+click input, navigate inside, promote without reload, split, Esc/backdrop/tab-switch close, no leaked webContents or renderer processes, setting off, private session).

## Network inspector

The inspector is a debug tool and is off by default (Settings → General → Developer). Nothing is attached until it is enabled and the Network view is first opened; rows are only streamed to the renderer while the view is open, and turning it off detaches from every tab and drops recorded rows. Once on, the Network panel attaches Electron's DevTools Protocol debugger to each loaded tab before its page navigation. It records request/response metadata and failures without installing another session-level `webRequest` callback, so the ad blocker keeps the session's single `webRequest` hook (Electron allows one listener per event; `src/main/adblock-engine.ts` owns it). The newest 1,000 requests are retained in process memory; request/response headers and bodies are fetched for the selected row, and response bodies are not retained unless requested. Clearing the panel drops the retained rows, and closing the app discards them. Since full DevTools headers can include cookies or authorization values, they are visible only in the local inspector and are not written to browser history or the profile.

## Overlay integration coverage

`test:electron-sidebar-overlay` launches the production build in an isolated temporary profile and navigates to a loopback-only synthetic page. It checks full-width page bounds, native page-under-chrome stacking, a zero-width hidden sidebar with real click-through at x=5, delayed edge hover reveal, pointer/keyboard/mouse-wheel delivery to the page while the sidebar is open, persistent-session use, cookie continuity, and switching between a live tab and the local New Tab. Optional full-window captures can be enabled with `SURFFISH_SCREENSHOT_DIR`.
