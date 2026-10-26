# Big-file cleanup — design (2026-10-26)

Split Surffish's three biggest modules into small, cohesively named files so
one behaviour can be found, grepped and changed without loading a 9,000-line
file. **Pure refactor — behaviour must not change.** The large test suite and
the per-area electron smoke tests are the guardrails.

Precedent and house pattern: Rowfish PR #16 and Inkfish's `refactor/big-files`.
Extract by stable identifiers, move code verbatim, keep facades so importers
never change, one commit per task, green gate at every step.

## Scope — round 1 (the three giants)

| File | Lines | Shape |
|---|---|---|
| `src/main/browser.ts` | 9,026 | god module: ~250 top-level functions across ~30 domains |
| `src/renderer/src/views/Browser.tsx` | 5,526 | one 4,852-line `Browser` component |
| `src/main/mini-window.ts` | 4,163 | flat module, clean seams |

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

Flat module with clean seams (as of `fee57d7`): `Mini` interface + constants
(194–342); registry (minis, lastActive, liveMinis, miniOf, miniWithTab,
currentMini, host, live, miniLabel, … 343–435); geometry (readGeometry,
saveGeometry, snapToCorner, openingBounds, miniDisplay, allMiniDisplays,
floats, updatePlan, ensurePanel, hidePanel, closePanel, mountHeader,
positionPanel, followPanel, layout, … 580–890); header behaviour (reveal/
hide, header drag, throw/glide 890–1307); page rewire (onPage, unwirePage,
pageMouse, rewirePage 1308–1453); header state sync (1454–1630); new-tab view
+ address (syncNewTabView, sendNewTabState, tickNewTabClock, syncAddress,
pushAddress, openAddress 1631–1863+).

```
main/
  mini-window.ts            facade: re-export all public names
  mini-window/
    types.ts                Mini, MiniRect, constants
    registry.ts             minis, lastActive, liveMinis, miniOf, miniWithTab,
                            currentMini, host, live, miniLabel
    geometry.ts             geometry persistence + panel layout/positioning
    panel.ts                ensurePanel/hidePanel/closePanel/mountHeader,
                            popout settle, keepAcrossSpace
    header.ts               reveal/hide, idle release, header drag, throw/glide
    page.ts                 onPage/unwirePage/pageMouse/rewirePage
    header-state.ts         headerState, sendHeaderState, refreshHeaderOf,
                            push handling
    newtab.ts               syncNewTabView, sendNewTabState, tickNewTabClock,
                            releaseNewTabView
    address.ts              syncAddress, dropdownRoom, addressLimit,
                            pushAddress, openAddress
    tabs.ts                 mini tab management (map at execution; the
                            1864–4163 tail covers tabs, dock, grouping,
                            menubar and the public API — re-scan boundaries
                            before starting this package)
    api.ts                  public entry points (create/pop-out/close, IPC
                            registration)
```

## Phases (coarse — order per task is decided at execution, dependency-first)

1. **Phase A — `browser/` package** (the big one): `types.ts` + `core.ts`,
   then the ~24 satellites, one commit each.
2. **Phase B — `views/browser/`**: helpers/icons → presentational blocks
   (Sidebar, Omnibox, ToolbarTrailing, Viewport) → hooks → root.
3. **Phase C — `mini-window/` package**: types → registry → geometry → panel →
   header → page → header-state → newtab → address → tabs → api.
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
