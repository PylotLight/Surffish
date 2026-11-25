# Native browser production-parity migration

Target: `poc/native-webkit-app`

Decision: native-first. Swift, AppKit and WKWebView remain the browser runtime. The Electron/React implementation on `main` is the behavioural reference; its UI is not embedded in the native app.

## Production reference inventory

The current production browser is not just a tab strip. Its implementation includes:

- Browser lifecycle and per-window tab state in `src/main/browser.ts`.
- Session and navigation setup in `src/main/browser-session.ts`, `src/main/browser-persistence.ts`, and `src/shared/window-session.ts`.
- Persistent profile and per-Space storage partitions, plus ephemeral private browsing.
- Tab pinning, groups, Spaces, split views, tab history, sleeping/archive, crash recovery and window restoration.
- Bookmarks, reading list, history, downloads, extensions, AdBlock, permissions, certificates, site settings, zoom, PDF handling and navigation safety.
- A configurable toolbar and overflow menu in `src/shared/toolbar-layout.ts` and `src/renderer/src/views/toolbar/`.
- A broad settings surface in `src/renderer/src/views/settings/`, backed by main-process persistence and shared defaults.

The native PoC currently has a minimal in-memory `TabManager`, one WKWebView per tab, a fixed sidebar, and a small set of prototype-only controls. That implementation is not the target architecture.

## Native architecture

Keep the browser runtime native and separate the responsibilities:

- `TabManager`: tab lifecycle, stable identity, active selection, pin ordering, grouping and Space membership.
- `BrowserSessionStore`: versioned, atomic session persistence and restore.
- `BrowserSettingsStore`: versioned preferences with explicit defaults and migrations.
- `BrowserWindowController`: window lifecycle, sidebar/toolbar composition, commands and keyboard shortcuts.
- `SidebarView`: production browser navigation and tab organization; no diagnostics or prototype controls.
- `ToolbarView`: navigation, omnibox, bookmarks, extensions, downloads and configurable overflow.
- Feature managers: history, bookmarks, downloads, permissions, content blocking and extension lifecycle. Each feature owns its data and UI integration rather than being hard-coded into the tab sidebar.

Use native WebKit data stores deliberately: the default profile is persistent; private browsing uses a non-persistent store. Space-specific persistent stores must be isolated before exposing partitioned Spaces in the UI.

## Migration phases

### N1 — Core browser state and persistence
- Stable tab IDs and production-shaped tab metadata.
- Pinned tabs stay ahead of ordinary tabs; move and close operations preserve the active tab.
- Restore tabs and the active tab on launch.
- Persist only normal tabs; never serialize private-tab URLs or metadata.
- Atomic, versioned storage under Application Support.
- Restore the saved start page and sidebar visibility.
- Add tests for session parsing, private exclusion, pin ordering and active-tab fallback.

### N2 — Production tab organization
- Tab groups with names, colours, collapse state and drag/drop.
- Spaces with separate identity, visibility, settings and optional isolated persistent website data stores.
- Split views with focus, resize, swap and restore.
- Tab overview, duplicate, reopen closed tab, move to new window and tab context menus.

### N3 — Production browser shell
- Replace the PoC sidebar with production information architecture: Spaces, tabs, pinned tabs, groups, bookmarks, history, reading list and downloads.
- Replace PoC toolbar with production navigation controls, omnibox, bookmark action, extension actions, contextual downloads/cast, configurable pinned toolbar items and overflow.
- Keep settings out of the tab list; provide a dedicated Settings window/tab and native menu shortcut.

### N4 — Settings and preferences
- Port production setting categories and defaults, not a visual mock.
- Persist settings with migrations and make each control affect the owning feature.
- Initial categories: Appearance, Tabs, Search, Privacy & Security, Site Settings, Downloads, Extensions, Spaces, Toolbar, Advanced.
- Preserve production concepts for search engine, start page, sidebar, toolbar layout, tab sleep, privacy, permissions, proxy, spellcheck and update preferences where supported by WebKit.

### N5 — Browser feature parity
- History, bookmarks, reading list, downloads, page zoom, find-in-page, context menus, permissions, certificate/security details, PDF viewing, reader mode, translation and site settings.
- Production-grade content blocking and filter updates; do not present the current small hard-coded rule list as production AdBlock.
- Extension management, per-extension permissions, toolbar actions and Bramble integration.
- Clearly document WebKit platform limits where Chromium/Electron behaviour cannot be reproduced exactly.

### N6 — Hardening and release
- Automated unit tests for persistence, tab operations, settings migrations and data partitioning.
- macOS build and UI validation at minimum/default window sizes.
- Verify restart restore, private-data non-persistence, multiple Spaces, grouped/pinned tabs, split view, downloads and extensions.
- Remove the PoC label only after the parity checklist is met.

## Prototype-only UI policy

Remove diagnostics and proof-of-concept controls from the normal sidebar and toolbar. Put any still-useful developer actions in a clearly separated **Testing** menu/submenu. The Testing menu is not a substitute for production feature UI.

- Memory/RSS sampler: Testing > Diagnostics.
- Touch ID authentication demo: Testing > Test Touch ID (until a real security/quick-unlock feature is designed).
- Manual extension installer and raw extension inventory: Testing > Extensions (until production extension management is implemented).
- AdBlock demo toggle: remove from the normal interface; retain its implementation only as a test hook until real filter-list parity exists.
- Keep the actual Bramble extension integration available as a browser extension action; do not expose the biometric demo as a Bramble security feature.

## Current implementation status

- N1 started: versioned atomic session file and stable tab metadata have been introduced.
- N1 started: normal tabs restore across launches; private tabs are excluded from persistence.
- N1 started: pinned tabs are ordered before ordinary tabs; basic move, group and Space metadata operations exist.
- Not yet validated: macOS compilation, WebKit runtime behaviour, restoration after process termination, and private-data isolation.
- N2–N6 remain outstanding. Do not claim production parity until each phase is implemented and tested.
