# Surffish Native — MVP and Electron parity roadmap

Target branch: `poc/native-webkit-app`

## Product direction

Build a production-quality, efficient native macOS browser using Swift, AppKit, WebKit and Network.framework. Electron `main` is the behavioural and feature reference; Electron/Chromium runtime code is not embedded in the native app.

Platform baseline: macOS 26+, Apple Silicon (arm64). CI must compile against the macOS 26 SDK on a macOS 26 runner. Do not lower the deployment target to macOS 15.

### Application profiles

Two isolated app profiles are required:

- **Production** — normal daily browser identity and data.
- **Development** — separate development configuration and disposable/testing data.

Each profile owns its settings, session, bookmarks/history/database, installed extensions, WebKit cookies, website storage and caches. Both profiles use the same native engine and feature implementation. They can run side-by-side as separate app bundles with distinct bundle identifiers. Profile selection is fixed by the app bundle or `--profile` / `SURFFISH_PROFILE` at launch; it is not a multiple-proxy-profile feature.

### Networking product scope

Do not implement multiple named upstream proxy profiles. The native MVP has one managed SSH destination and one SOCKS5 endpoint:

- Native OpenSSH manages SSH authentication and a local dynamic SOCKS5 forward (`-D`); the SSH host is the exit point.
- The local endpoint has a user-configurable port (default 1080); OpenSSH's dynamic forward (`-D`) provides the SOCKS5 service.
- Browser routing and external-client availability are independently selectable.
- Loopback is the default listener address.
- Optional LAN binding is explicitly opt-in and carries a no-authentication warning.
- SOCKS5 clients use remote hostname resolution through the SSH connection (for example, `socks5h://127.0.0.1:1080`); the SSH host is the network exit point.
- One browser-wide managed proxy is the MVP. Later routing may support direct bypass rules and per-site selection between Direct and this one managed endpoint, but not a catalogue of upstream proxies.

## Current native implementation

### Landed

- SwiftUI-first browser shell, compact rail/full sidebar panels and Settings surfaces, hosted by AppKit; WKWebView tabs, toolbar/omnibox, menus and Testing menu remain native integrations.
- Stable tab identifiers, pinning, groups/Space metadata and saved session.
- Private tabs use non-persistent WebKit data stores and are excluded from saved sessions.
- Versioned settings and session persistence.
- Development and Production profile directories.
- Separate persistent WebKit website data store identifiers for Development and Production.
- Profile-isolated extension installation directories and Bramble lookup.
- Profile-specific Bramble Touch ID PRF secrets in Keychain, preventing Development and Production from sharing the same biometric secret.
- Native OpenSSH dynamic forwarding (`-D`) with launchd SSH-agent discovery, Homebrew PATH support, process monitoring, diagnostics and reconnect backoff.
- WebKit SOCKSv5 proxy configuration with proxy failover disabled, pointing to the same local SSH-managed SOCKS endpoint used by external applications.
- Independent browser proxy and external SOCKS service settings.
- Configurable local listen port; the default is `127.0.0.1:1080`.
- Loopback-only listener by default; optional `0.0.0.0` binding when external sharing is enabled.
- Copyable `socks5h://127.0.0.1:<port>` endpoint.
- Profile-local persistent bookmarks, browsing history and Reading List; private-tab navigations remain excluded from history and Reading List additions.
- Native Settings pages for General, Appearance, Privacy, Extensions, Connection and About, with section navigation and search limited to supported, behavior-backed controls.
- One sidebar collapse control in the toolbar; sidebar tabs, history and bookmarks surfaces with a separate pinned-tab strip.
- macOS 26 arm64 build workflow.

### Implementation status for the native parity pass

- **Electron reference:** `origin/main` at `fbabc6aa03ba3b39eee92ed4388c39fa919f3b87`, using Electron `46.0.0-alpha.12`.
- **Implemented:** the single toolbar sidebar toggle; SwiftUI compact rail/full-panel shell with a pinned cluster, animated reveal and page-card width coordination; profile-local bookmarks, history and Reading List; SwiftUI Settings pages for General, Appearance, Privacy, Extensions, Connection and About; profile-scoped website-data clearing; and persisted WebKit content-rule enablement.
- **Added in the previous parity tranche; prior native build/PR CI passed:** a local `surffish://newtab/` dashboard using the profile search engine and pinned/recent/bookmark links (with recent history hidden in private tabs); saved local New Tab themes and quick-link sources with existing pages refreshed on Save & Apply; migration from the legacy external New Tab default while preserving custom start pages; native find-in-page; duplicate and in-memory reopen-closed-tab actions (private tabs excluded from reopen); bookmark pin migration and pinned-site actions; a Reading List toolbar/panel with read/unread and remove actions; and tab/library context menus. The [dedicated native macOS 26 arm64 build](https://github.com/PylotLight/Surffish/actions/runs/45624927499) and [PR CI retry](https://github.com/PylotLight/Surffish/actions/runs/45624906878) passed on `d8c0a32`. Interactive runtime QA remains open.
- **Added in this follow-up; macOS build passed, interactive runtime QA pending:** the [dedicated macOS 26 arm64 build](https://github.com/PylotLight/Surffish/actions/runs/45629675951) passed on `147a69b`. This tranche adds searchable Tabs, History, Bookmarks and Reading List panels; drag reordering within pinned and unpinned tab partitions; per-tab WebKit Back/Forward history menus; a distinct keep-sidebar-open pin; and a persisted 220–440 point width adjustable by drag or a General Settings slider. The one toolbar collapse affordance remains the only collapse button.
- **Added in the current code pass; native source-contract suite passes 22/22, macOS build and interactive runtime QA pending:** Settings use section navigation/search over supported controls; the Appearance page has profile-local custom shortcuts (up to 12, HTTP(S)-only) plus New Tab clock format (12/24-hour), date visibility and size; the sidebar History panel supports All/Today/7 days/30 days filters, clear-by-period, entry removal and clearing a host with its subdomains; and inactive restored tabs wait to load until selected. The expanded sidebar panel follows the glass shell's live width while resizing, and the toolbar remains the only collapse control. This Linux environment has no Swift compiler or AppKit/WebKit runtime, so the current changes have not been compiled or interactively verified here.
- **Incomplete:** full Electron settings parity, downloads, window geometry/multiple windows, comprehensive navigation history, multi-select/group/tab overview, pinned-site reorder, exact Electron rail choreography, robust error/crash UI, site permission/certificate management, production filter-list updates, and the broader M1–M6 feature inventory below. New Tab photo backgrounds/weather, full find-result UX, history retention/counts/sorting and persistent closed-tab recovery are not implemented. Session restore now defers inactive tab loads but still lacks window-state and crash recovery. Settings search covers supported native controls only; unsupported Electron categories are not exposed as fake switches.
- **Obsolete roadmap assumptions:** references to forwarding `-L` traffic to a separately managed NAS SOCKS daemon, configuring a NAS SOCKS host/port, or treating that NAS daemon as the exit are stale. The implementation uses `ssh -D`; the SSH host is the exit point. Do not reintroduce the old model without an explicit product decision.
- **Runtime QA boundary:** this Linux environment cannot launch AppKit/WebKit; the successful macOS 26 build verifies compilation, but interactive browser QA still needs a macOS 26+ machine. The tunnel is mostly working in the POC; remaining SSH-host, sleep/wake, LAN-client and tunnel-drop acceptance is separate follow-up, not a blocker for this UI parity pass.
- **WebKit compatibility limits:** Chrome-only extension APIs and Chromium DevTools request interception/process metrics are not assumed to exist. Record each incompatibility and design native alternatives; do not label them complete based on a Settings control or a successful compile.

### Still required for the native networking MVP

The POC's SSH path is mostly working. The remaining checks below are acceptance/observability follow-up and do not block the broader sidebar, Settings or browser-shell parity work.

- Verify the managed SSH destination using the same validation rules as Electron's `parseSshTarget`.
- Verify the SSH destination and confirm `ssh -D` opens the selected local SOCKS port and relays traffic through that SSH host.
- Add a real connection test and clear UI states for starting, ready, retrying, failed-authentication and port-conflict.
- Validate configured listener port conflicts without endless retries.
- Ensure browser traffic stays blocked if the tunnel drops; ensure external clients receive a clear failed connection and never a direct fallback.
- Test local DNS behaviour with `socks5h`, IPv4/IPv6, large transfers and concurrent clients.
- Verify SSH agent, IdentityFile, ProxyJump, ProxyCommand, known_hosts and host-key failure behaviour on the actual NAS.
- Handle sleep/wake, Wi-Fi changes, NAS restart and app quit.
- Test the optional LAN listener from a second device; document firewall requirements and the absence of SOCKS authentication.
- Add live byte counters, active-client count and a connection diagnostics panel.
- Add unit/integration tests for settings validation, process arguments, port state and reconnect classification.

### Still required for the browser MVP

- Per-tab back/forward and right-click history menus now use WebKit; richer navigation state and proper load/error handling remain required.
- Browser window geometry, multiple windows and reliable app lifecycle.
- Tab creation/close, pinning, keyboard shortcuts, basic duplicate/reopen/context-menu actions, and drag reorder within pinned/unpinned groups now exist; multi-select, full reopen persistence and the complete Electron tab interaction model remain required.
- Session restore now restores tab metadata and loads only the saved active tab at first; inactive tabs load when selected. Persisted window state, crash recovery and deferred writes remain open.
- Persistent profile data separation, private browsing isolation and browsing-data deletion.
- History is profile-local, private-safe and searchable, with All/Today/7-day/30-day filters, selected-period clearing, single-entry removal and clear-by-site (including subdomains); retention, counts and sorting remain open.
- Reading List now has profile-local persistence, toolbar add/remove, panel open/read/unread/remove and private-tab exclusion; search, sorting, counts and richer offline/article metadata remain open.
- Downloads with progress, pause/resume, reveal/open and destination settings.
- Native permissions, certificate information and safe navigation decisions.
- Production-quality ad/tracker blocking and filter-list updates; the current native rule set remains intentionally limited.
- Expanded Settings category parity; New Tab clock format, date visibility and size are now persisted and applied, and all controls currently exposed by native Settings must remain persisted and connected to behavior.
- Error pages, crash recovery, loading indicators and progress; basic native find-in-page is added, but match counts and complete find UX remain open.
- macOS runtime QA on the user's machine, including real SSH and browser usage.

## Electron feature parity inventory

The following is the full category map to use when decomposing native parity. It is derived from the current Electron main-process modules, shared feature contracts, renderer views and settings components on `main`.

### 1. Browser shell and macOS window integration

- Native window lifecycle, titlebar and traffic-light layout.
- Glass sidebar, reveal/hide/pin behaviour, resize and backdrop.
- Toolbar layout, navigation buttons, address bar, progress and overflow.
- Omnibox parsing, search engine selection, autocomplete and keyword searches.
- Context menus, app menu, window menu and keyboard shortcuts.
- Fullscreen, popovers, sheets and external-link handling.
- Multiple browser windows and per-window state.
- Default-browser registration and macOS integration.

### 2. Tabs and navigation

- Vertical tabs, tab selection, close/new/duplicate/reopen.
- Pinned tabs, drag reorder, multi-select and batch actions.
- Per-tab loading, favicon, audio, mute and volume indicators.
- Back/forward navigation and full navigation history menus.
- Find in page, page zoom, reload/stop and navigation error handling.
- Tab overview, tab search and command-palette tab actions.
- Tab crash detection, recovery and restore.
- Private tabs and private windows.
- Tab context menus and move-to-window actions.

### 3. Tab groups, Spaces and split view

- Named and coloured tab groups, collapse state and group drag/drop.
- Multi-tab selection and group operations.
- Spaces switcher, per-Space tab collections and visibility.
- Per-Space settings, website data stores and optional proxy choice.
- Split view with two tabs, focus switching, divider resize, swap and pop-out.
- Tab overview and split-view restoration.
- Space persistence and keyboard shortcuts.

### 4. Sessions, profiles and persistence

- Development and Production profile separation.
- Profile-specific WebKit data stores, cookies, local storage and caches.
- Profile-specific settings, database, history, bookmarks and extensions.
- Window geometry, open tabs, active tab, groups, Spaces and split view persistence.
- Lazy restoration and deferred writes.
- SQLite profile database, migrations, JSON fallback and recovery.
- Session-cookie protection and safe storage where appropriate.
- Import/export and migration from Electron data where feasible.
- Private data excluded from persistent session and history.
- Browsing-data clearing by type, site and time range.

### 5. Bookmarks and reading list

- Bookmark add/edit/remove and folder hierarchy.
- Bookmarks manager, bookmarks bar and toolbar/menu surfaces.
- Drag/drop and reorder.
- Import from Chrome, Brave, Edge, Arc, Firefox, Safari and HTML.
- Reading list add/remove, unread state, counts and reading-list panel.
- Search, sorting and persistent storage.

### 6. History

- Local browsing history, deduplication and retention.
- Search/filter and history panel.
- Back/forward navigation menus.
- Clear history by time range and site.
- Private browsing exclusion.

### 7. Downloads and file handling

- Download manager and toolbar popover.
- Progress, pause, resume, cancel, retry and completion.
- Open/reveal in Finder and destination handling.
- Download history and clear actions.
- File-type handling and safe download decisions.

### 8. Extensions and Bramble

- WebKit Web Extensions controller and lifecycle.
- Install from Chrome Web Store, CRX, ZIP or directory where supported.
- Extension inventory, enable/disable/remove and update checks.
- Extension permissions and per-extension settings.
- Extension toolbar actions and popup windows.
- Content scripts, background workers and messaging compatibility.
- Bramble password manager integration and native bridge.
- Bramble quick unlock, Touch ID, PIN and camera/QR workflows.
- Document Chromium-only extension API incompatibilities.

### 9. Ad and tracker blocking

- uBlock Origin-compatible filter-list coverage where feasible.
- EasyList, EasyPrivacy, Peter Lowe and URLhaus lists.
- Network request blocking and cosmetic/scriptlet rules.
- Filter list refresh, caching, compilation and stats.
- Per-site exemptions and enable/disable.
- Update and diagnostics UI.
- Performance and compatibility testing against WebKit.

### 10. Privacy, security and permissions

- HTTPS-only mode and HTTP downgrade handling.
- Certificate inspection and trust details.
- Site permissions: camera, microphone, location, notifications, clipboard and screen sharing.
- Per-site settings and permission reset.
- Browsing-data clearing and private browsing.
- Safe navigation, external links and download checks.
- Cloudflare challenge compatibility.
- Bramble biometric/quick-unlock security.
- Screen-sharing and camera permission integration.

### 11. Proxy and networking

- One managed SSH destination using native OpenSSH.
- Browser-wide SOCKS5 route.
- External SOCKS5 listener on a configurable port.
- Loopback and opt-in LAN bind.
- Remote DNS / SOCKS5 hostname handling.
- SSH agent, key files, known_hosts, ProxyJump and ProxyCommand.
- Tunnel status, logs, reconnect and sleep/wake recovery.
- Proxy health monitoring and kill switch.
- Direct bypass for local-network hosts.
- Optional per-site Direct vs managed-SSH routing.
- Network inspector, request details and HAR export.
- Network overrides/request mocks.
- External app usage counters and listener health.
- No multiple named upstream proxy catalogue in the native MVP.

### 12. Network inspector and developer tools

- Opt-in request capture.
- Per-tab request list and request/response detail.
- Headers, timing, status and transfer information.
- HAR export.
- Request overrides and mocks.
- Proxy diagnostics and routing explanation.
- Task manager with CPU/memory per tab/process.
- Testing menu and developer diagnostics.

### 13. Reader, reading and content tools

- Reader mode and article extraction.
- Reader typography, font size, width and theme.
- Read Aloud queue, selection/article reading, voice catalog and playback speed.
- On-device voice assets and downloads.
- Sentence highlighting and playback controls.
- Translation UI, language selection and translation service.
- Clean-link copying and tracking-parameter stripping.

### 14. PDF and document tools

- Native PDF viewer and page navigation.
- PDF edit mode and form filling.
- Form calculations and formatting scripts.
- Signature fields, saved signatures and initials.
- Annotation and signature ink.
- Rotate, reorder and delete pages.
- Save/flatten copies and blob-backed PDFs.
- PDF read-aloud integration.

### 15. Capture and media

- Region, visible-area, full-page and scrolling screenshots.
- Copy, save and annotate captures.
- Picture-in-Picture and media-session controls.
- Per-tab mute and volume.
- Cast discovery, device selection and streaming.
- Cast screen/tab mirroring and remote control where supported.
- Media playback retention when tabs are inactive.

### 16. New Tab and personalization

- New Tab dashboard.
- Clock, quick links, pinned and most-visited sites.
- Background/photo feeds and custom backgrounds.
- Weather forecast, city search and weather settings.
- New Tab customization panel.
- Search keywords and bang shortcuts.
- New Tab loading and caching performance.

### 17. Feeds and page watchers

- RSS, Atom and JSON Feed discovery.
- Feed reader and saved feed list.
- GitHub repository release/commit/tag/Actions presets.
- Page watchers for selected page regions/text.
- Change detection, notification and pause/disable.
- Watcher settings and persistence.

### 18. Productivity windows and surfaces

- Glance link preview sheets and keep-as-tab behaviour.
- Mini windows, always-on-top, tuck/peek and restore.
- Mini-window dock, global show/hide and pinned pages.
- Menubar integration and quick access.
- Tab drag into/out of mini windows.
- Window geometry and animation behaviour.

### 19. Local AI

- Local AI provider configuration.
- Provider/model discovery and settings.
- Browser-context actions and local AI request handling.
- Model download/storage lifecycle where applicable.
- Privacy and permission boundaries for page context.

### 20. Performance, lifecycle and reliability

- Tab sleep/hibernation and auto-archive.
- Preserve active, audible and media-playing tabs.
- Restore archived tabs.
- Preconnect and omnibox prerender.
- Wake snapshots and startup restoration.
- Memory saver and diagnostics.
- Deferred writes and bounded caches.
- Crash guards, process recovery and shutdown cleanup.
- Lazy feature loading and background task scheduling.

### 21. Settings and configuration categories

The Electron settings surface currently contains these categories/components. Native Settings must cover the same concepts, with each control connected to real behaviour:

1. Appearance.
2. Browser / startup / search.
3. Tabs and tab behaviour.
4. Toolbar layout and pinned actions.
5. Spaces.
6. Privacy and security.
7. Site data and site permissions.
8. Network rules and site routing.
9. Proxy kill switch.
10. SSH / SOCKS5 connection.
11. Extensions and Bramble.
12. Ad blocking.
13. Spellcheck.
14. Search keywords.
15. Page watchers.
16. Feeds.
17. Read Aloud.
18. Local AI.
19. Cast.
20. Glance.
21. Mini window.
22. Memory saver and tab archive.
23. Preload pages.
24. Command palette.
25. Default browser.
26. Updates.
27. Diagnostics / developer tools.

### 22. Updates, diagnostics and support

- GitHub release feed and update notifications.
- Update settings and manual check.
- Diagnostics view, logs and profile status.
- Network and proxy diagnostics.
- Troubleshooting and safe recovery.
- Testing menu for development-only hooks.
- Crash/error reporting policy and exportable diagnostics.

## Delivery phases

### M0 — Native foundation and networking MVP

- macOS 26 build, two app bundles and profile isolation.
- Stable native browser shell and persistent/private tabs.
- Configurable SSH SOCKS5 endpoint usable by browser and other applications.
- Reliable process lifecycle, status, reconnect and fail-closed behaviour.
- Minimum viable settings, history, bookmarks, downloads and permissions.
- Runtime validation on the developer Mac and NAS.

### M1 — Daily-browser usability

- Complete tab operations, navigation history, session/window restore.
- Production sidebar, toolbar, tab groups and command palette.
- Bookmarks, history, reading list and downloads.
- New Tab and appearance settings.
- Find-in-page, zoom, context menus and private windows.
- **Current status: partial.** The native pass adds searchable library panels and Settings, pinned/unpinned tab reorder, per-tab back/forward menus, keep-open pin and resizable sidebar, plus a local New Tab with profile-local editable shortcuts, configurable clock, find-in-page, duplicate/reopen actions, pinned sites and context menus. History now has time/site clearing, and restored inactive tabs load lazily. Downloads, full navigation/window behavior, full appearance controls and production rail interactions remain open; this code pass still needs a macOS build and runtime QA.

### M2 — Network and privacy parity

- Proxy health, kill switch, local-network bypass and one-proxy site rules.
- Network inspector, HAR and request overrides.
- Ad blocking and filter updates.
- HTTPS-only, certificates, permissions, site settings and data clearing.

### M3 — Extensions and productivity

- Extension manager and Bramble integration.
- Reader, Read Aloud, translation and PDF viewer/editor.
- Screenshots, feeds, page watchers and clean links.

### M4 — Organization and advanced UI

- Spaces, groups, split view and tab overview.
- Glance, mini windows and menubar surfaces.
- Toolbar customization, full settings search and command palette parity.

### M5 — Integrations and performance

- Cast, Local AI, weather, memory saver, tab archive and preconnect.
- Wake snapshots, task manager, diagnostics and lifecycle hardening.

### M6 — Release parity and polish

- Complete settings category parity.
- Full keyboard/accessibility support and macOS polish.
- Data migration, import/export and update system.
- Regression suite, performance comparisons and release packaging.
- Explicitly document any Electron/Chromium feature that WebKit cannot reproduce.

## MVP acceptance criteria

The native browser is MVP-ready when:

- Production and Development launch independently and never share cookies, sessions, settings or installed extensions.
- A normal browsing session survives quit/relaunch; private browsing leaves no persistent session/history/site data.
- Tabs, navigation, pinned tabs, bookmarks, history, downloads and permissions work reliably.
- A user can configure an SSH destination, choose the local dynamic SOCKS5 listen port, start the managed `ssh -D` tunnel and copy a working `socks5h://127.0.0.1:<port>` endpoint for other apps; the SSH host is the network exit point, and no separate NAS SOCKS server is required.
- Browser routing can be enabled independently from external SOCKS sharing.
- The endpoint binds to loopback by default; LAN access requires explicit opt-in.
- Tunnel loss never silently falls back to direct browser traffic.
- macOS 26 CI builds pass and the app has been runtime-tested on the developer's macOS 26+ machine with the real NAS.
- No feature is marked complete based solely on compiling or appearing in Settings; each exposed control must have verified behaviour.
