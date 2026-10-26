# Big-file cleanup — design (2026-10-26)

Split Surffish's three biggest modules into small, cohesively named files so
one behaviour can be found, grepped and changed without loading a 9,000-line
file. **Pure refactor — behaviour must not change.** The large test suite and
the per-area electron smoke tests are the guardrails.

Precedent and house pattern: Rowfish PR #16 and Inkfish's `refactor/big-files`.
Extract by stable identifiers, move code verbatim, keep facades so importers
never change, one commit per task, green gate at every step.

## Scope — round 1 (the three giants)

| File                                 | Lines | Shape                                                                                    |
| ------------------------------------ | ----- | ---------------------------------------------------------------------------------------- |
| `src/main/browser.ts`                | 9,026 | stateful hub: ~390 top-level declarations, ~30 domains, one 38-declaration lifecycle SCC |
| `src/renderer/src/views/Browser.tsx` | 5,526 | one 4,852-line `Browser` component                                                       |
| `src/main/mini-window.ts`            | 4,163 | stateful runtime with one registry and coupled lifecycle domains                         |

**Out of scope:** `bramble-poc.ts` (1,374) is a PoC, not production code. The
1,000–1,500 tier (`commands.ts`, `read-aloud.ts`, `mini-window-dock.ts`,
`signature.ts`, `feeds.ts`, `web-store-extensions.ts`, `dnr.ts`, `screenshot.ts`,
`browser-shell.ts`) is a **follow-up round**. Parked PR #280 (feedback window)
must not be touched.

## Target structure

### `src/main/browser.ts` → `src/main/browser/` package

A hub-and-spoke split: `core.ts` owns the shared mutable registry and the
tab-lookup/publish hub that everything else calls; every satellite imports
only from `types.ts` + `core.ts` (plus Electron/shared), so no cycles. The
facade `src/main/browser.ts` re-exports every public name, so `ipc.ts`,
`commands.ts`, `index.ts` and tests compile unchanged.

Line ranges below are as of `fee57d7`, orientation only.

```
main/
  browser.ts                facade: re-export all public names
  browser/
    types.ts                BrowserTab, PdfEditorTabState, FindState,
                            BrowserWindowState, channel names, constants
                            (~422–600)
    core.ts                 windowStates registry + tab lookups
                            (windowStateFor, currentWindowState, allTabs,
                            findTab, tabForContents, activeTabOf,
                            neighbourInSpace, pageBoundsOf, getTab, currentUrl,
                            pageTitle, getState, getTabSummaries) + publish
                            (publishTabs, publishState, publishAllWindows,
                            broadcastQueue, notifyHistoryChanged,
                            noteWindowTitles) (~543–862, 1076–1151)
    favicons.ts             persistPageFavicon … showTabFavicon (~863–1075)
    session.ts              freezeBrowserSession, sessionHistoryOf,
                            persistOpenTabs, forgetTabNavigationHistory
                            (~1152–1313)
    bookmarks.ts            windowGeometry, toggleTabBookmark,
                            bookmarkTabAndEdit, bookmarkAllBrowserTabs,
                            getBrowserTabPageInfo (~1314–1412)
    tab-lifecycle.ts        applyTabBounds, sleep/hibernate (hibernateTab,
                            scheduleTabSleep, markTabInactive,
                            cancelSleepTimer), openBackgroundTab, dispose*,
                            ensureTabLoaded, noteLoadRejection,
                            activateTabInternal (~1413–1775)
    tab-menu.ts             showTabContextMenu, tabMenuExtras,
                            pinnedTabMoveItems, showBrowserTabContextMenu,
                            moveTabMenuItems (~1776–2101)
    tab-view.ts             resolveBrowserViewPreload, handOffGoogleSignIn,
                            pagePopupHost, tabWebPreferences, createTabView
                            (~450 lines), removeDestroyedTab, openPageMadeTab,
                            createPdfEditorView, replaceTabView
                            (~2102–2900)
    pdf-editor.ts           openPdfEditor, restoreStashedPdfSource,
                            allowLeavingPdfEditor, closePdfEditor,
                            togglePdfEditor, savePdfEditor,
                            hasUnsavedPdfEdits, pdfEditorTabFor
                            (~2901–3066)
    prerender.ts            glanceSourceTab, tabHistoryForPrerender,
                            canTakePrerender, adoptPrerenderedView
                            (~3067–3293)
    mini-tab.ts             creatingMiniTab, miniTabHomes/Origins,
                            sidebarRowAt, sendSidebarDropHint, miniTabOf,
                            browserTargetForMini, miniStateFor,
                            runMiniTabCommand, tabAudioSummary, miniTabAudio,
                            attachMiniWindowState, canPopOutTab,
                            canPopOutBrowserTab, getBrowserActiveTabId,
                            hasMiniWindows (~3294–3522)
    windows.ts              createTab, BrowserWindowInit, attachBrowserView
                            (~350 lines), browserWindowFactory,
                            pageTitleOfWindow, browserWindowLabel, canMoveTabTo,
                            detachTabFromWindow, moveTabsWithSplit,
                            adoptTabIntoWindow, moveBrowserTabToWindow,
                            moveBrowserTabToNewWindow, dropBrowserTabOutside,
                            listBrowserWindows (~3882–4656)
    extension-pages.ts      getExperimentalExtensionFrames, newPrivateBrowserTab,
                            openExternalBrowserTab, translate*, newBrowserTab,
                            openExtensionPageTab, bramble extension tabs,
                            synthetic tab ids, listExtensionTabs,
                            createExtensionTab, … (~4747–5245)
    tab-commands.ts         TabCommand, TAB_COMMAND_SHORTCUTS,
                            tabMenuAccelerator, runTabCommand,
                            handleBrowserShortcut*, selectBrowserTabByNumber
                            (~5247–5676)
    panels.ts               closeOverviewForPanel, openClearBrowsingData,
                            toggleBrowserPanel, find bar (publishFindState,
                            openFindBar, setBrowserFindQuery, stepFind,
                            closeFindBar) (~5677–5815)
    tab-ops.ts              activate/cycle, recently-closed, volume/mute,
                            close, pin, move, duplicate, reload, suspend
                            (~5901–6335)
    navigation.ts           navigateBrowser, navigateTabTo, setBrowserBounds,
                            syncBrowserBoundsToWindow (~6336–6503)
    gestures.ts             mac trackpad swipe (~6504–6794) + pinch
                            (~7297–7418)
    tab-pictures.ts         tabPictureChanged, memory saver, settings tab
                            (settingsTabTargets … openSettingsTab,
                            openSettingsSectionFromChrome), thumbnails
                            (pendingPictures, scheduleTabPictureEncode,
                            encodeTabPicture, captureTabThumbnail,
                            getTabOverviewItems) (~6795–7296)
    nav-history.ts          browserBack/Forward, getBrowserNavHistory,
                            browserGoToNavHistory, browserReload,
                            dismissActiveLoadError, activeTabHasLoadError,
                            browserStop, browserPictureInPicture
                            (~7419–7572)
    tab-archive.ts          archive candidates/capture/close/open
                            (~7573–7693)
    split-view.ts           keepSplitTabsTogether … resetBrowserSplitSizes,
                            dropTabIntoSplit, splitTabMenuItems,
                            attachSplitSurface, getBrowserSplitState
                            (~7705–8170)
    spaces.ts               encodeWindowSpaces, getBrowserSpacesSnapshot,
                            publishSpaces, switch/cycle/select space,
                            resyncTabSessions, moveBrowserTabToSpace,
                            spaceTabMenuItems, count/delete/merge spaces
                            (~8171–8491)
    tab-groups.ts           sidebarSwipeId, finishSidebarSwipe,
                            keepTabGroupsTogether, groupById … listBrowserTabGroups,
                            activeBrowserTabGroupId, browserWindowOfTab,
                            TabSelectionHooks, setTabSelectionHooks,
                            setTabGroupMenuHook, groupTabMenuItems,
                            showBrowserTabGroupMenu (~8492–9026)
```

Execution order: `types.ts` + `core.ts` first (the hub), then satellites in
any order that keeps each intermediate state compiling — when two satellites
mutually reference, pull the smaller direction's calls through `core.ts` or
leave the callee in `core.ts`. Re-run the declaration-boundary scan
(`grep -nE '^(export )?(async )?(function|const|let|var|class|interface|type|enum) '`
) before each task; line ranges drift.

### `views/Browser.tsx` → `views/browser/`

As of `fee57d7`: 288–673 constants + small components; 674–2914 the `Browser`
component body (refs, ~60 hooks, handlers, derived values); 2915–5526 one JSX
return with three top-level blocks:

- `<aside class="browser-sidebar">` — 2927–3414 (~490 lines)
- `<header class="browser-chrome">` — 3417–4221 (~805 lines): toolbar
  leading, `omnibox-wrap` (3424–3936, ~510 lines), toolbar trailing
  (3937–4220)
- `<div class="browser-viewport">` — 4222–5522 (~1,300 lines)

```
views/
  Browser.tsx               facade: re-export default
  browser/
    chrome-helpers.ts       constants + pure helpers (httpOrigin, historyHost,
                            withOfflinePhotoFallbacks, isSettingsSection,
                            isIntegrationsMode, settingsNavMode, …)
    icons.tsx               NewTabSiteIcon, PinnedSiteIcon, HighlightedText,
                            SuggestionFavicon, DownloadsToolbarProgress
    Sidebar.tsx             the aside: tabs/pins, history, downloads,
                            bookmarks, network, site modes
    Omnibox.tsx             omnibox-wrap: address input, suggestions,
                            private/insecure/zoom pills
    ToolbarTrailing.tsx     toolbar trailing cluster (downloads, site
                            actions, surffish menu, bramble button)
    Viewport.tsx            browser-viewport: new tab page, settings pane,
                            downloads/bookmarks/network/diagnostics content,
                            interstitials, find bar
    useSidebarChrome.ts     sidebar mode/width/resize/hover/peek state
    useOmnibox.ts           address query, suggestions, navigateTo/navigate
    useNewTab.ts            weather, photos, pins, widgets, preferences
    useToolbar.ts           toolbar context, overflow, surffish menu entries
    useBramble.ts           bramble PoC state + toolbar handlers
    Browser.tsx             root component, target < ~500 lines
```

Existing extracted hooks (`useSpaces`, `useBookmarks`, `useTabDragSort`,
`usePinnedDragSort`, `useTabSelection`, `useAddressBarSync`, …) stay as-is.

### `src/main/mini-window.ts` → `src/main/mini-window/` package

The audited module is a 4,163-line stateful runtime with one `Mini[]` registry
and cross-calls among geometry/panels, header and drag, page listeners,
new-tab/address, tab grouping/drop, IPC, and menu-bar behavior. Do not assume
every contiguous range is an independent module. The stable source seams include
registry/host state (about 347–424), geometry and panel layout (584–892),
reveal/header drag/throw (904–1311), page listener lifecycle (1312–1457),
header-state synchronization (1458–1634), new-tab/address (1635–1962), IPC
(2024–2305), create/open lifecycle (2347–2775), tab/drop/grouping (2776–3541),
and menu-bar/popout/menus (3542–4135). Re-scan declarations before each move.

Existing neighboring modules include `mini-window-entry.ts` (the actual lazy
facade/host contract), `mini-window-dock.ts`, `mini-window-page.ts`,
`mini-window-menubar.ts`, and focused page/motion helpers. Candidate package
boundaries to validate against the dependency graph—not files that already
exist—are:

```text
main/
  mini-window.ts            runtime facade; preserve existing public exports
  mini-window/
    types.ts                Mini/runtime contracts (only shared types)
    registry.ts             the one Mini[] owner and registry queries, if its
                            dependencies can be kept one-way
    geometry.ts             geometry persistence + panel layout/positioning
    header.ts               reveal/hide, idle release, header drag, throw/glide
    page-lifecycle.ts       page listener attach/detach and event handling
    header-state.ts         header state publication and refresh
    newtab-address.ts       new-tab view and address-field lifecycle
    tab-drag.ts             tab drag/drop and grouping behavior
    menu-bar.ts             menu-bar/popout state, timers and tray behavior
    ipc.ts                  IPC registration only if it reduces coupling
```

At d9c2bb9, `src/main/mini-window/tabs.ts` and `api.ts` do not exist. Keep the
browser-owned tab registry in `browser.ts`; preserve the dynamic import from
`mini-window-entry.ts` so the mini runtime stays lazy. Avoid a speculative
~2,300-line `tabs.ts`; retain a domain in the runtime hub when extracting it
would introduce cycles or split listener/timer ownership.

## Phases (coarse — order per task is decided at execution, dependency-first)

1. **Phase A — `browser/` package** (the big one): `types.ts` + `core.ts`,
   then the ~24 satellites, one commit each.
2. **Phase B — `views/browser/`**: helpers/icons → presentational blocks
   (Sidebar, Omnibox, ToolbarTrailing, Viewport) → hooks → root.
3. **Phase C — `mini-window` runtime**: extract bounded, stateful adapters first
   (the native-menu controller in this slice). Keep the live mini registry, tab
   adoption, window/event lifecycle and tray/popout orchestration in the runtime
   hub until a typed host and lifecycle tests justify moving them. `tabs.ts` and
   `api.ts` are not source modules at d9c2bb9.
4. **Final gate** + PR.

## Ground rules (every task)

1. **Extract by stable identifiers** (declaration names, JSX class markers
   such as `className="browser-sidebar"`), not line numbers — the ranges above
   are as of `fee57d7`, orientation only.
2. **Each task ends green:** `bun run format:check && bun run typecheck &&
bun test && bun run build`. CI additionally runs the per-area electron
   smokes (`test:electron-*`); for tasks touching browser chrome, mini
   windows or the new tab page, run the matching smoke locally (e.g.
   `test:electron-mini-window`, `test:electron-address-bar-sync`,
   `test:electron-spaces`, `test:electron-tab-groups`). Record the `bun test`
   pass/fail counts before starting; a new failure is a regression, the same
   set is not.
   Known flake (pre-existing, not a regression): `test:electron-address-bar-sync`
   has timed out intermittently on the `linux A` CI runner ("Timed out waiting
   for the typed text …"); a re-run of the failed job passes.
3. **One commit per task**, conventional prefix by area:
   `refactor(browser): …`, `refactor(chrome): …`, `refactor(mini-window): …`.
4. **Move code verbatim.** Only imports, prop types and wiring are new. Rename
   a symbol only when its current name is actively misleading.
5. **Keep facades** for `browser.ts`, `Browser.tsx`, `mini-window.ts` so every
   existing importer (`ipc.ts`, `commands.ts`, `index.ts`, tests) keeps
   compiling unchanged.
6. **Grep moved identifiers** after each move (`grep -rn "<name>" src`): one
   occurrence outside the new home = import-only = dead import to remove.
7. Presentational components receive **value + setter/named-callback props**;
   state stays in the parent. Hooks own derived state and return typed
   objects.
8. Watch for doc comments when slicing: a slice must include the comment above
   its first declaration, and header rebuilds must not leave a stale import
   block behind (both bit the Inkfish run). The type-checker reports errors
   incrementally — re-run until clean.

## Branch + merge

- `git checkout main && git pull && git checkout -b refactor/big-files`.
- Push the branch; open the PR with `ghp` (personal repo) when CI is green;
  squash-merge, delete the branch.
- **No releases** from this branch.

## Full source review corrections (d9c2bb9)

The source was audited by declarations and effects, not by carrying forward the
older `fee57d7` line ranges. Those ranges are orientation only; use the actual
stable identifiers when extracting. These findings supersede target boundaries
above wherever they conflict.

### Main-process browser ownership and omitted seams

`windowStates` is the sole authoritative registry for normal, private and mini
windows; each `BrowserWindowState.tabs` owns the tab objects. Do not create a
second registry in a feature module. Search engine, sleep, memory-saver, session
freeze, recently closed tabs, synthetic extension IDs, gestures, thumbnail
encodes, menu hooks and other feature state also have one current owner; assign
each to exactly one new module and have consumers import it, rather than copying
or reinitializing it. Preserve import-time initialization for the broadcast
queue and the `setTabResyncHandler`, `setGlanceHost`,
`setOmniboxPrerenderHost`, `setMiniWindowHost`, `setTabVolumeHost` and
`setSettingsSectionOpener` registrations, plus permission-toast throttling.

The `setMiniWindowHost({...})` adapter (currently between `hasMiniWindows` and
`createTab`) is a real, stateful browser/mini-window integration seam, not a
missing declaration range. It closes over the browser registry and coordinates
tab creation, adoption/return, navigation, publication, session persistence,
private-window compatibility, settings/bookmarks/history, audio and new-tab
data. Keep the tab registry and adoption/lifecycle mutations in the browser
owner; give the mini-window runtime a narrow, explicitly typed host instead of
making it import the browser facade. Diagnostics and downloads are another
omitted cluster: preserve `getBrowserTabProcessEntries`, WebContents-ID lookup,
and `markBrowserDownloadStarted`, including its deferred empty-tab close and
return-to-recent-tab behavior. Also place zoom, selected search engine, active
and sleeping tab network context, and sleep-minute rescheduling explicitly;
they share mutable settings or tab-session state and are not isolated pure
helpers.

### Renderer state and effect contracts

`Browser` is a composition root, but it owns the browser/tab/chrome snapshots,
surface precedence and cross-surface transactions. Split views receive values
and named actions; they must not fork authoritative sidebar, settings-revision,
tab or chrome state. Preserve the coupled `navigateTo` archive/prerender/address
sync transaction, toolbar-wide dismissal and focus return, viewport bounds by
surface, preferences echo guard and save coalescing, weather identity/stale
response protection, proxy draft-versus-applied state, and the timer/observer/
subscription cleanup contracts. In particular, keep New Tab privacy/visibility
rules, sidebar group/split/drop identity, preconnect/prerender ordering, and
content-vs-toolbar-vs-sidebar behavior explicit in controller interfaces and
tests.

### Actual mini-window boundary

At d9c2bb9, neither `src/main/mini-window/tabs.ts` nor `api.ts` exists. The
actual public lazy facade and host contract are in `src/main/mini-window-entry.ts`;
it dynamically imports `mini-window.ts`, while `browser.ts` installs the
`MiniWindowHost` implementation. Keep that lazy import and one browser-owned tab
registry. The mini runtime owns each `Mini`, its collection/active-window and
menu-bar state, timers, event listeners, page/header/new-tab views and drag
lifecycle. Split along the declarations present in the audited runtime, and
keep IPC registration/API dispatch distinct only where it reduces coupling;
do not create a speculative ~2,300-line `tabs.ts`. Closing a mini must continue
to clear the per-window resources and stale registry/menu-bar/drag state.

### Baseline and verification record

Before source edits, `bun run typecheck` and `bun run build` passed. The full test
suite reported 1,854 passed, 1 skipped, 2 failed and 1 unhandled module error;
one failure is `scripts/perf/app-payload.test.ts` expecting no missing runtime
files but finding `node_modules/cpu-features/lib/index`, and the unhandled error
is Bun's Electron import lacking named export `app` in
`src/main/store/shutdown.test.ts`. `bun run format:check` also fails on this
design document as present at baseline. Electron smoke tests must use the local
`node_modules/.bin/electron` executable under `xvfb-run` in this environment;
a prior `electron`-on-PATH attempt was invalid and is not a software failure.
Keep these baseline observations separate from refactor regressions.
