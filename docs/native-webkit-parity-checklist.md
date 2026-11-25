# Surffish Native WebKit parity checklist

**Electron reference:** [`origin/main` at `fbabc6aa03ba3b39eee92ed4388c39fa919f3b87`](https://github.com/PylotLight/Surffish/tree/fbabc6aa03ba3b39eee92ed4388c39fa919f3b87). The local `main` branch is stale and is not a comparison source.  
**Native reference:** PR #347's feature branch, including the changes in this parity pass. The native implementation is Swift/AppKit/WebKit/Network.framework for macOS 26+ arm64; it is intentionally not an Electron/Chromium port.  
**Roadmap:** [`native-webkit-mvp-roadmap.md`](native-webkit-mvp-roadmap.md).

Status labels distinguish code from verified parity: **Implemented in this pass (build/QA pending)** means source changes are present but the native macOS build and interactive behavior have not yet been verified; **Partial** means a useful native foundation exists but important Electron behavior is missing; **Missing** means no equivalent is present; **Native alternative required** means a Chromium feature must not be represented as a direct WebKit port.

## Snapshot

This is a substantial M1 usability slice, not full Electron parity. The pass adds a profile-local New Tab page, native find-in-page, duplicate/reopen tab actions, pinned bookmark sites in the sidebar pin strip, and tab/bookmark context actions. It also keeps the existing single toolbar collapse control. The biggest remaining day-to-day gaps are the fully animated rail/sidebar behavior, omnibox autocomplete, session/window lifecycle, downloads, reading list, permissions/certificate UI, and the broader Electron settings/content-tool surface.

## Product and interface checklist

### Browser shell, frame, sidebar and rail

- **Single sidebar-collapse affordance — Implemented; regression-checked.** The sidebar itself does not render a second collapse button; the toolbar owns the single toggle. `scripts/native-poc-ui-contract.test.cjs` checks this contract.
- **Translucent macOS frame and inset page card — Partial.** Native already has a glass-backed toolbar/sidebar, full-height sidebar below the toolbar, and an inset rounded page surface. This preserves the Surffish visual language, but it is not the same compositor or frame-state implementation as Electron.
- **Collapsed rail — Partial.** This pass adds pinned bookmark sites beside pinned tabs. The native strip is still a simple AppKit horizontal strip; it does not reproduce Electron's persistent compact rail, pinned cluster, all-tab rail, footer pin, pixel-aligned shape morph, hover/focus/reveal lock, and page/backdrop coordination. See the [Electron rail implementation](https://github.com/PylotLight/Surffish/blob/fbabc6aa03ba3b39eee92ed4388c39fa919f3b87/src/renderer/src/views/browser/SidebarRail.tsx) and [browser shell](https://github.com/PylotLight/Surffish/blob/fbabc6aa03ba3b39eee92ed4388c39fa919f3b87/src/renderer/src/views/Browser.tsx).
- **Sidebar panels — Partial.** Tabs, History and Bookmarks exist. Pinned tabs and pinned sites share the top strip. The panels do not yet match Electron's full row actions, search/filtering, drag interactions, group/Space integration, and reveal/resize behavior.
- **Toolbar and overflow — Partial.** Native has back, forward, reload/stop, tabs/history/bookmarks, bookmark, address field, progress and Bramble/extension actions. Electron has a broader customizable toolbar/overflow surface; native has no equivalent layout customization.
- **Sidebar collapse/expand animation — Missing.** Native width/hover behavior is simpler and has no equivalent of Electron's measured rail/panel morph, drag-resize, focus retention or shape-transition coordination. Do not describe visual similarity as behavioral parity.

### Navigation, omnibox and New Tab

- **Back, forward, reload/stop and load progress — Partial.** The native toolbar wires these to `WKWebView`; navigation history menus, richer error handling and full Electron behavior are absent.
- **Address parsing and search engine — Partial.** The native omnibox supports basic URL-versus-search routing and a saved search engine. It lacks Electron's suggestion matching across tabs/history/bookmarks, keyword search indicators, robust navigation parsing and suggestion keyboard flow.
- **Built-in New Tab route — Implemented in this pass (build/QA pending).** New tabs default to `surffish://newtab/`, served locally by `BrowserNewTabSchemeHandler`; the page uses the profile's selected search engine, shows the clock/date, and prefers pinned sites, then recent history, then bookmarks. Private tabs omit recent history. The page has no remote dependency.
- **New Tab customization — Partial.** The first-party page covers the basic dashboard, not Electron's customizable shortcuts, quick-link preferences, local/remote photo backgrounds and refresh/cache behavior, or weather/location/providers. See [Electron New Tab background handling](https://github.com/PylotLight/Surffish/blob/fbabc6aa03ba3b39eee92ed4388c39fa919f3b87/src/main/new-tab-backgrounds.ts), [weather handling](https://github.com/PylotLight/Surffish/blob/fbabc6aa03ba3b39eee92ed4388c39fa919f3b87/src/main/new-tab-weather.ts), and [renderer New Tab state](https://github.com/PylotLight/Surffish/blob/fbabc6aa03ba3b39eee92ed4388c39fa919f3b87/src/renderer/src/views/Browser.tsx).

### Tabs, navigation history and session

- **Create, select, close and pin tabs — Partial.** Core AppKit/WebKit tab management and saved tab metadata exist; pinned tabs have a strip. Drag sorting, multi-selection, batch operations, complete tab overview/search, audio/mute indicators and richer tab navigation history are not complete.
- **Duplicate tab — Implemented in this pass (build/QA pending).** The active tab and normal tab context menu can duplicate a tab, preserving private state, pin state and group/Space metadata.
- **Reopen closed tab — Implemented in this pass (build/QA pending).** The menu/shortcut can reopen a bounded in-memory stack of up to 20 non-private tabs. The stack is intentionally not persisted across app relaunches; private tabs are excluded.
- **Find in page — Implemented in this pass (build/QA pending).** A native find bar uses Apple's Swift `WKWebView.find(_:configuration:)` API with `caseSensitive = false` and wrapping, previous/next, Escape and a simple found/no-match status. Match counts and broader Electron find UX are not implemented.
- **Groups and Spaces — Partial.** Native tab models persist group/Space metadata, but the Electron interaction model, group management, Space switching and split view are not present.
- **Session restore and window lifecycle — Partial.** A profile-local session can restore tabs and active selection, but restored tabs load eagerly. Geometry, multiple windows, robust lifecycle/crash recovery, lazy restore and deferred persistence remain roadmap work.
- **Private browsing — Partial.** Private tabs use non-persistent WebKit stores and are excluded from saved sessions/history; this pass also excludes private tabs from reopen-closed history and hides recent history on their New Tab. Private-window isolation and complete data-deletion guarantees still need runtime verification.

### Bookmarks, history and other library surfaces

- **Bookmarks — Partial.** Profile-local add/remove and a sidebar list exist. This pass adds backward-compatible `isPinned` persistence, pin/unpin context actions and a pinned-site strip. Folder hierarchy, manager, reorder, imports and broad search/sort are absent.
- **History — Partial.** Profile-local history, private exclusion and clear-all exist. Search, time/site clearing, retention controls and back/forward history menus remain missing.
- **Reading list — Missing.** Electron's saved-for-later/unread surface has no native store or panel.
- **Bookmark pin migration — Implemented in this pass (build/QA pending).** Older JSON bookmark records that lack `isPinned` decode as unpinned rather than failing the library snapshot.

### Settings, privacy and site controls

- **Settings shell — Partial.** Native exposes General, Privacy, Extensions, Connection and About, with persistence for supported behaviors. It is not equivalent to Electron's broad settings categories.
- **Appearance, tab behavior and toolbar configuration — Missing/partial.** A few startup/sidebar controls exist; full theme, tab, toolbar and pinned-action preferences are not available.
- **Privacy and data clearing — Partial.** Private tabs, history clearing and profile-scoped website-data clearing exist. Granular type/site/time clearing, HTTPS-only behavior and broader site controls remain incomplete.
- **Permissions and certificates — Missing.** There is no production site-permission manager or certificate inspection/trust surface. WebKit permission callbacks and platform prompts need deliberate native UX.
- **Ad/tracker blocking — Partial.** A persisted native WebKit content-rule toggle exists, but the filter set, update/cache/diagnostic behavior and compatibility are intentionally limited. Electron/Chromium request interception is not a parity substitute.
- **Search keywords, spellcheck, watchers, feeds, Read Aloud and local AI settings — Missing.** No native controls or complete native implementations are present.

### Downloads, extensions and page/content tools

- **Downloads — Missing.** No download manager with progress, pause/resume/cancel, destination, open/reveal, history or safe file decisions.
- **Web extensions and Bramble — Partial.** The POC uses WebKit's extension APIs and has Bramble integration. Chrome Web Store/CRX, background-worker and Chrome API compatibility cannot be assumed; extension-specific parity requires a documented compatibility layer and tests.
- **Reader, translation and Read Aloud — Missing.** No native article extraction, reader controls, translation flow, voice catalog or playback queue.
- **PDF viewer/editor and document tools — Missing.** No native PDF editing, form filling, annotation, signature or page operations.
- **Screenshots and media controls — Partial/missing.** Basic WebKit rendering exists; there is no full-page/scroll capture pipeline, annotation, media session, per-tab volume or cast surface.
- **Feeds and page watchers — Missing.** No native feed discovery/reader, repository presets, region watchers, change detection or notifications.
- **Glance, mini windows, menubar and tab overview — Missing.** No native equivalents yet.

### Networking, diagnostics and performance

- **SSH/SOCKS5 foundation — Partial, substantial.** Native OpenSSH `ssh -D`, profile-separated settings, browser routing and optional external SOCKS sharing exist. The SSH/NAS acceptance items, health state, kill-switch verification, sleep/wake, local-network bypass, listener observability and runtime tests remain open in the roadmap. NAS-SOCKS validation is follow-up, not a blocker for this UI pass.
- **Network inspector, HAR, overrides and request mocks — Native alternative required.** Chromium request interception/DevTools contracts cannot be copied into WebKit. If prioritized, build opt-in instrumentation using only supported WebKit/network surfaces and mark its visibility and coverage limits.
- **Task manager / per-tab process CPU and memory — Native alternative required.** WebKit process ownership and metrics differ from Chromium; do not present Electron process APIs as available in the native app. Native memory diagnostics are not full task-manager parity.
- **Tab sleep/archive, preconnect and wake snapshots — Missing/partial.** No validated native equivalent for Electron's lifecycle/performance features is present.

## Native applicability and explicit non-ports

The following Electron capabilities require native alternatives or an explicit compatibility limitation rather than a blind port: Chromium DNR and `webRequest` interception, DevTools request capture/overrides, Chromium renderer-process metrics, Electron compositor and DOM-driven sidebar morph behavior, and Chrome-only extension APIs. WebKit Web Extensions, `WKContentRuleList`, `WKNavigationDelegate`, AppKit menus and native window APIs are separate mechanisms; one should not be marked equivalent merely because a similarly named settings control exists. The roadmap's WebKit compatibility section remains authoritative.

## Roadmap phase status

- **M0 — Foundation/networking MVP: Partial.** Native app/profile/tab foundation and the SSH dynamic-SOCKS architecture exist. Real macOS/NAS runtime validation, robust permission/download coverage and networking acceptance remain open.
- **M1 — Daily-browser usability: Partial, improved by this pass.** Basic New Tab, find-in-page, duplicate/reopen, pinned sites and tab/bookmark context actions are now represented in code. Downloads, reading list, lazy restore, full navigation history, drag/reorder, window lifecycle and a production rail remain open.
- **M2 — Network/privacy parity: Partial.** Limited content rules and profile data clearing exist; filter updates, permissions, certificates, HTTPS-only, site routing and inspection remain open.
- **M3 — Extensions/productivity: Partial.** WebKit extension/Bramble foundation exists; reader, Read Aloud, translation, PDF, capture, feeds and watchers remain open.
- **M4 — Organization/advanced UI: Mostly missing.** Space/group metadata exists, but split view, overview, command palette, mini windows, Glance and complete rail/settings search are not implemented.
- **M5 — Integrations/performance: Mostly missing.** Cast, local AI, weather, memory saver, archives, preconnect, snapshots and task-manager parity remain open.
- **M6 — Release parity/polish: Not complete.** Accessibility, migration/import/export, update system, end-to-end regression and macOS runtime QA remain open.

## Verification status for this pass

- Focused source-contract suite: `node --test scripts/native-poc-ui-contract.test.cjs` — 7 tests passed in the current workspace.
- Native Swift/AppKit/WebKit compilation: not available on this Linux host; the macOS 26 arm64 workflow is the build authority.
- Interactive AppKit/WebKit behavior: not verified here; it requires macOS 26+ runtime QA.
- The checklist is anchored to the exact Electron commit above. It is not a claim that all Electron features are applicable or complete in the native app.
