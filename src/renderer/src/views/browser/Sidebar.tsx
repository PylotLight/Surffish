import type {
  BrowserState,
  BrowserTabSummary,
  BrowsingHistoryEntry,
  PinnedSite,
} from "../../../../shared/types";
import { useMemo } from "react";
import type {
  Dispatch,
  FocusEvent,
  KeyboardEvent,
  PointerEvent,
  RefObject,
  SetStateAction,
} from "react";
import { usePinnedDragSort, usePinReorderModifier } from "../usePinnedDragSort";
import { useTabDragSort } from "../useTabDragSort";
import { useTabSelection } from "../tab-groups/useTabSelection";
import type { SidebarBackdropState } from "../../../../shared/sidebar-backdrop";
import type { SpacesSnapshot } from "../../../../shared/spaces";
import type { TabEntry } from "../../../../shared/split-view";
import type { TabGroupHeaderEntry } from "../../../../shared/tab-groups";
import type { DiagnosticsTabUsage } from "../../../../shared/diagnostics";
import {
  MAX_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
} from "../../../../shared/persistence";
import {
  describeTabSleep,
  isRestoredSleep,
} from "../../../../shared/tab-sleep";
import { httpOrigin, historyHost, isSettingsSection } from "./chrome-helpers";
import { sidebarBackdropClass, SidebarBackdropLayer } from "../SidebarBackdrop";
import { SPACE_COLOR_VALUES } from "../../../../shared/spaces";
import { TAB_GROUP_COLOR_VALUES } from "../../../../shared/tab-groups";
import { withTabUsageHint } from "../tabUsageHints";
import { formatVisitedAt } from "../../lib/format";
import { PinnedSiteIcon } from "./icons";
import {
  PinnedTabIcon,
  PrivateGlyph,
  TabAudioButton,
  TabFavicon,
} from "../TabIndicators";
import { SplitTabEntry } from "../SplitTabEntry";
import { TabGroupHeader } from "../tab-groups/TabGroupHeader";
import { UpdateBadge } from "../settings/UpdateBadge";
import { ArchivedTabsSidebar } from "../lazy-views";
import { SpacesSwitcher } from "../spaces/SpacesSwitcher";
import { TabCastBadge } from "../cast/CastButton";
import { SidebarRail } from "./SidebarRail";
import type { BrowserSurface, SidebarMode } from "./chrome-helpers";

export interface SidebarProps {
  activeSpace: SpacesSnapshot["spaces"][number] | undefined;
  beginSidebarResize: (event: PointerEvent<HTMLDivElement>) => void;
  clearHistory: () => Promise<void>;
  createNewTab: () => void;
  exitPanel: () => void;
  finishSidebarResize: (event: PointerEvent<HTMLDivElement>) => void;
  handleSidebarPointerEnter: () => void;
  handleSidebarPointerLeave: (event: PointerEvent<HTMLElement>) => void;
  handleSidebarResizeKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
  keepSidebarVisibleForFocus: () => void;
  moveSidebarResize: (event: PointerEvent<HTMLDivElement>) => void;
  openHistoryEntry: (entry: BrowsingHistoryEntry) => Promise<void>;
  openPinnedSite: (site: PinnedSite) => Promise<void>;
  openSettings: () => void;
  pinnedListRef: RefObject<HTMLDivElement | null>;
  releaseSidebarFocus: (event: FocusEvent<HTMLElement>) => void;
  savePinnedSites: (sites: PinnedSite[]) => Promise<void>;
  selectTabOnKeyboard: (
    event: KeyboardEvent<HTMLDivElement>,
    tabId: string,
  ) => void;
  setSidebarMode: Dispatch<SetStateAction<SidebarMode>>;
  setSidebarPinned: Dispatch<SetStateAction<boolean>>;
  sidebarOnScreen: boolean;
  /** Whether the panel is open (pinned, hovered, focused, or a full panel mode). */
  sidebarVisible: boolean;
  /** Whether this surface's rail is painted (the overlay view is up, or this is the visible layer). */
  railOnScreen: boolean;
  spaces: SpacesSnapshot | null;
  tabUsage: Record<string, DiagnosticsTabUsage>;
  settingsTab: BrowserState["settings"];
  sidebarBackdrop: SidebarBackdropState | null;
  sidebarMode: SidebarMode;
  sidebarPinned: boolean;
  sidebarWidth: number;
  cachedSiteIcons: Record<string, string>;
  historyQuery: string;
  setHistoryQuery: Dispatch<SetStateAction<string>>;
  surface: BrowserSurface;
  browser: BrowserState;
  history: BrowsingHistoryEntry[];
  pinReorder: ReturnType<typeof usePinReorderModifier>;
  pinnedTabDrag: ReturnType<typeof usePinnedDragSort>;
  pinnedSiteDrag: ReturnType<typeof usePinnedDragSort>;
  pinnedTabsById: Map<string, BrowserTabSummary>;
  pinnedSites: PinnedSite[];
  filteredHistory: BrowsingHistoryEntry[];
  tabDrag: ReturnType<typeof useTabDragSort>;
  tabSelection: ReturnType<typeof useTabSelection>;
  tabEntriesByKey: Map<
    string,
    TabEntry<BrowserTabSummary> | TabGroupHeaderEntry
  >;
  revealingGroups: ReadonlySet<string>;
  sleepingTabHoverRef: RefObject<{
    push(id: string): void;
    cancel(): void;
  } | null>;
  castTabId: string | null;
  tabs: BrowserTabSummary[];
  sidebarRef: RefObject<HTMLElement | null>;
}
export function Sidebar(props: SidebarProps) {
  const {
    activeSpace,
    beginSidebarResize,
    clearHistory,
    createNewTab,
    exitPanel,
    finishSidebarResize,
    handleSidebarPointerEnter,
    handleSidebarPointerLeave,
    handleSidebarResizeKeyDown,
    keepSidebarVisibleForFocus,
    moveSidebarResize,
    openHistoryEntry,
    openPinnedSite,
    openSettings,
    pinnedListRef,
    releaseSidebarFocus,
    savePinnedSites,
    selectTabOnKeyboard,
    setSidebarMode,
    setSidebarPinned,
    sidebarOnScreen,
    sidebarVisible,
    railOnScreen,
    spaces,
    tabUsage,
    settingsTab,
    sidebarBackdrop,
    sidebarMode,
    sidebarPinned,
    sidebarWidth,
    cachedSiteIcons,
    historyQuery,
    setHistoryQuery,
    surface,
    browser,
    history,
    pinReorder,
    pinnedTabDrag,
    pinnedSiteDrag,
    pinnedTabsById,
    pinnedSites,
    filteredHistory,
    tabDrag,
    tabSelection,
    tabEntriesByKey,
    revealingGroups,
    sleepingTabHoverRef,
    castTabId,
    tabs,
    sidebarRef,
  } = props;
  // The tab list collapses to its icon rail instead of disappearing; a full panel is always open.
  const hasRail = sidebarMode === "tabs";
  const collapsed = hasRail && !sidebarVisible;
  const railTabs = useMemo(() => {
    const ordered: BrowserTabSummary[] = [];
    for (const id of tabDrag.orderedIds) {
      const entry = tabEntriesByKey.get(id);
      if (!entry) continue;
      if (entry.kind === "split") ordered.push(...entry.tabs);
      else if (entry.kind === "tab") ordered.push(entry.tab);
    }
    return ordered;
  }, [tabDrag.orderedIds, tabEntriesByKey]);
  const railPinnedTabs = useMemo(
    () =>
      pinnedTabDrag.orderedIds
        .map((id: string) => pinnedTabsById.get(id))
        .filter(
          (tab: BrowserTabSummary | undefined): tab is BrowserTabSummary =>
            Boolean(tab),
        ),
    [pinnedTabDrag.orderedIds, pinnedTabsById],
  );
  const railPinnedSites = useMemo(
    () =>
      pinnedSiteDrag.orderedIds
        .map((url: string) =>
          pinnedSites.find((site: PinnedSite) => site.url === url),
        )
        .filter((site: PinnedSite | undefined): site is PinnedSite =>
          Boolean(site),
        ),
    [pinnedSiteDrag.orderedIds, pinnedSites],
  );
  return (
    <aside
      ref={sidebarRef}
      className={`browser-sidebar${activeSpace ? " has-spaces" : ""}${hasRail ? " has-rail" : ""}${collapsed ? " is-collapsed" : ""}${sidebarBackdropClass(surface, sidebarBackdrop)}${browser.private ? " is-private-window" : ""}`}
      style={
        activeSpace
          ? ({
              "--active-space-color":
                SPACE_COLOR_VALUES[
                  activeSpace.color as keyof typeof SPACE_COLOR_VALUES
                ],
            } as React.CSSProperties)
          : undefined
      }
      data-space-id={activeSpace?.id}
      aria-label="Browser sidebar"
      onMouseEnter={handleSidebarPointerEnter}
      onMouseLeave={handleSidebarPointerLeave}
      onFocusCapture={keepSidebarVisibleForFocus}
      onBlurCapture={releaseSidebarFocus}
    >
      {surface === "sidebar" && (
        <SidebarBackdropLayer state={sidebarBackdrop} cardRef={sidebarRef} />
      )}
      {window.api.platform === "darwin" && (
        <div className="sidebar-window-controls" aria-label="Window controls">
          <button
            className="sidebar-window-control is-close"
            type="button"
            aria-label="Close window"
            title="Close window"
            onClick={() => void window.api.browser.windowControl("close")}
          />
          <button
            className="sidebar-window-control is-minimize"
            type="button"
            aria-label="Minimize window"
            title="Minimize window"
            onClick={() => void window.api.browser.windowControl("minimize")}
          />
          <button
            className="sidebar-window-control is-zoom"
            type="button"
            aria-label="Toggle window zoom"
            title="Toggle window zoom"
            onClick={() => void window.api.browser.windowControl("toggle-zoom")}
          />
        </div>
      )}
      <div className={`sidebar-body${hasRail ? " has-rail" : ""}`}>
        {hasRail && (
          <SidebarRail
            animate={railOnScreen}
            cachedSiteIcons={cachedSiteIcons}
            onCreatePrivateTab={() =>
              void window.api.browser.tabs.createPrivate()
            }
            onCreateTab={createNewTab}
            onOpenPinnedSite={(site: PinnedSite) => void openPinnedSite(site)}
            onOpenSettings={openSettings}
            onTogglePinned={() =>
              setSidebarPinned((pinned: boolean) => !pinned)
            }
            onUnpinPinnedSite={(site: PinnedSite) =>
              void savePinnedSites(
                pinnedSites.filter(
                  (pinned: PinnedSite) => pinned.url !== site.url,
                ),
              )
            }
            pinnedSites={railPinnedSites}
            pinnedTabs={railPinnedTabs}
            sidebarPinned={sidebarPinned}
            tabs={railTabs}
          />
        )}
        <div className="sidebar-panel" inert={collapsed || undefined}>
          {sidebarMode !== "tabs" && !isSettingsSection(sidebarMode) && (
            <div className="sidebar-heading">
              <strong>
                {sidebarMode === "history"
                  ? "History"
                  : sidebarMode === "downloads"
                    ? "Downloads"
                    : sidebarMode === "bookmarks"
                      ? "Bookmarks"
                      : sidebarMode === "network"
                        ? "Network"
                        : "This site"}
              </strong>
              {sidebarMode === "history" && (
                <button
                  className="sidebar-icon-button"
                  type="button"
                  aria-label="Clear browsing history"
                  title="Clear history"
                  disabled={history.length === 0}
                  onClick={() => void clearHistory()}
                >
                  <span aria-hidden="true">⌫</span>
                </button>
              )}
            </div>
          )}

          {sidebarMode === "tabs" && (
            <section
              className="sidebar-pinned-sites"
              aria-label="Pinned tabs and bookmarks"
            >
              {/* Cmd+drag (Ctrl+drag off macOS) reorders pins; a plain drag does nothing. */}
              <div
                ref={pinnedListRef}
                className={`sidebar-pinned-list${pinReorder.armed ? " is-reorder-armed" : ""}${pinnedTabDrag.draggingId || pinnedSiteDrag.draggingId ? " is-reordering" : ""}`}
                onPointerEnter={pinReorder.track}
                onPointerMove={pinReorder.track}
                onPointerDown={pinReorder.track}
                onPointerLeave={() => {
                  if (!pinnedTabDrag.draggingId && !pinnedSiteDrag.draggingId)
                    pinReorder.disarm();
                }}
              >
                {pinnedTabDrag.orderedIds
                  .map((id: string) => pinnedTabsById.get(id))
                  .filter(
                    (
                      tab: BrowserTabSummary | undefined,
                    ): tab is BrowserTabSummary => Boolean(tab),
                  )
                  .map((tab: BrowserTabSummary) => (
                    <PinnedTabIcon
                      key={`tab:${tab.id}`}
                      tab={tab}
                      dragProps={{
                        ...pinnedTabDrag.itemProps,
                        "data-pin-kind": "tab",
                        "data-pin-id": tab.id,
                        onPointerDown: (event) =>
                          pinnedTabDrag.onPointerDown(event, tab.id),
                      }}
                    />
                  ))}
                {pinnedSiteDrag.orderedIds
                  .map((url: string) =>
                    pinnedSites.find((site: PinnedSite) => site.url === url),
                  )
                  .filter((site: PinnedSite | undefined): site is PinnedSite =>
                    Boolean(site),
                  )
                  .map((site: PinnedSite) => (
                    <PinnedSiteIcon
                      key={`bookmark:${site.url}`}
                      site={site}
                      cachedFaviconUrl={
                        cachedSiteIcons[httpOrigin(site.url) ?? ""]
                      }
                      onOpen={() => void openPinnedSite(site)}
                      onUnpin={() =>
                        void savePinnedSites(
                          pinnedSites.filter(
                            (pinned: PinnedSite) => pinned.url !== site.url,
                          ),
                        )
                      }
                      dragProps={{
                        ...pinnedSiteDrag.itemProps,
                        "data-pin-kind": "site",
                        "data-pin-id": site.url,
                        onPointerDown: (event) =>
                          pinnedSiteDrag.onPointerDown(event, site.url),
                      }}
                    />
                  ))}
              </div>
            </section>
          )}

          {sidebarMode === "history" ? (
            <div className="history-sidebar">
              <label className="history-search">
                <span aria-hidden="true">⌕</span>
                <input
                  type="search"
                  value={historyQuery}
                  onChange={(event) => setHistoryQuery(event.target.value)}
                  placeholder="Search history"
                  aria-label="Search browsing history"
                />
              </label>
              <div
                className="history-list"
                aria-label="Recent browsing history"
              >
                {filteredHistory
                  .slice(0, historyQuery ? 400 : 250)
                  .map((entry: BrowsingHistoryEntry) => (
                    <button
                      className="history-item"
                      key={entry.id}
                      type="button"
                      onClick={() => void openHistoryEntry(entry)}
                      title={entry.url}
                    >
                      <strong>{entry.title}</strong>
                      <span className="history-host">
                        {historyHost(entry.url)}
                      </span>
                      <time dateTime={new Date(entry.visitedAt).toISOString()}>
                        {formatVisitedAt(entry.visitedAt)}
                      </time>
                    </button>
                  ))}
                {filteredHistory.length === 0 && (
                  <p className="sidebar-empty">
                    {historyQuery
                      ? "No matching history"
                      : "No browsing history yet"}
                  </p>
                )}
              </div>
            </div>
          ) : (
            <div
              ref={tabDrag.listRef}
              className={`tab-list${tabDrag.draggingId ? " is-drag-sorting" : ""}`}
              role="tablist"
              aria-label="Open tabs"
              onClickCapture={tabDrag.onClickCapture}
            >
              {tabSelection.count >= 2 && (
                <div
                  className="tab-selection-bar"
                  role="toolbar"
                  aria-label="Selected tabs"
                >
                  <span className="tab-selection-count">
                    {tabSelection.count} tabs selected
                  </span>
                  <button
                    type="button"
                    title={`Group the selected tabs (${window.api.platform === "darwin" ? "⌘G" : "Ctrl+G"})`}
                    onClick={tabSelection.group}
                  >
                    Group
                  </button>
                  <button
                    className="tab-selection-clear"
                    type="button"
                    aria-label="Clear selection"
                    title="Clear selection (Esc)"
                    onClick={tabSelection.clear}
                  >
                    ×
                  </button>
                </div>
              )}
              {tabDrag.orderedIds
                .map((id: string) => tabEntriesByKey.get(id))
                .filter((entry) => entry !== undefined)
                .map((entry) =>
                  entry.kind === "group" ? (
                    <TabGroupHeader
                      key={entry.key}
                      entryKey={entry.key}
                      group={entry.group}
                      dragging={tabDrag.draggingId === entry.key}
                      handlers={tabDrag.itemHandlers(entry.key)}
                    />
                  ) : entry.kind === "split" ? (
                    <SplitTabEntry
                      groupColor={
                        entry.tabs[0]?.group
                          ? TAB_GROUP_COLOR_VALUES[
                              entry.tabs[0].group
                                .color as keyof typeof TAB_GROUP_COLOR_VALUES
                            ]
                          : undefined
                      }
                      key={entry.key}
                      entryId={entry.key}
                      tabs={entry.tabs}
                      dragging={tabDrag.draggingId === entry.key}
                      animate={sidebarOnScreen}
                      handlers={tabDrag.itemHandlers(entry.key)}
                      selected={tabSelection.selectedKeys.has(entry.key)}
                      onSelectClick={(event) =>
                        tabSelection.handleClick(event, entry.key)
                      }
                      onMoveBy={(offset) => tabDrag.moveBy(entry.key, offset)}
                      titleFor={(tab) =>
                        withTabUsageHint(
                          tab.sleeping
                            ? `${tab.title} — ${describeTabSleep(tab.sleep).toLowerCase()}; select to reload`
                            : tab.title,
                          tabUsage[tab.id],
                        )
                      }
                      onActivate={(id) => {
                        void window.api.browser.tabs.activate(id);
                        if (
                          sidebarMode === "downloads" ||
                          sidebarMode === "bookmarks"
                        )
                          exitPanel();
                      }}
                    />
                  ) : (
                    (({ tab }) => (
                      <div
                        className={`tab-item${tab.active ? " is-active" : ""}${tab.private ? " is-private" : ""}${tab.sleeping ? " is-sleeping" : ""}${tabDrag.draggingId === tab.id ? " is-dragging" : ""}${tab.group ? " is-grouped" : ""}${tab.group && revealingGroups.has(tab.group.id) ? " is-group-revealing" : ""}${tabSelection.selectedKeys.has(tab.id) ? " is-multi-selected" : ""}`}
                        style={
                          tab.group
                            ? ({
                                "--group-color":
                                  TAB_GROUP_COLOR_VALUES[
                                    tab.group
                                      .color as keyof typeof TAB_GROUP_COLOR_VALUES
                                  ],
                              } as React.CSSProperties)
                            : undefined
                        }
                        key={tab.id}
                        data-browser-tab-id={tab.id}
                        role="tab"
                        aria-selected={tab.active}
                        aria-grabbed={
                          tabDrag.draggingId === tab.id ? true : undefined
                        }
                        tabIndex={0}
                        title={withTabUsageHint(
                          tab.sleeping
                            ? `${tab.title} — ${describeTabSleep(tab.sleep).toLowerCase()}; select to reload`
                            : tab.title,
                          tabUsage[tab.id],
                        )}
                        onMouseEnter={
                          tab.sleeping
                            ? () => sleepingTabHoverRef.current?.push(tab.id)
                            : undefined
                        }
                        onMouseLeave={
                          tab.sleeping
                            ? () => sleepingTabHoverRef.current?.cancel()
                            : undefined
                        }
                        onClick={(event) => {
                          if (tabSelection.handleClick(event, tab.id)) return;
                          void window.api.browser.tabs.activate(tab.id);
                          if (
                            sidebarMode === "downloads" ||
                            sidebarMode === "bookmarks"
                          )
                            exitPanel();
                        }}
                        // Middle-click closes the tab; swallow the press so Chromium doesn't start autoscroll.
                        onMouseDown={(event) => {
                          if (event.button === 1) event.preventDefault();
                        }}
                        onAuxClick={(event) => {
                          if (event.button !== 1) return;
                          event.preventDefault();
                          event.stopPropagation();
                          void window.api.browser.tabs.close(tab.id);
                        }}
                        onKeyDown={(event) => {
                          if (
                            event.altKey &&
                            event.shiftKey &&
                            (event.key === "ArrowUp" ||
                              event.key === "ArrowDown")
                          ) {
                            event.preventDefault();
                            tabDrag.moveBy(
                              tab.id,
                              event.key === "ArrowUp" ? -1 : 1,
                            );
                            return;
                          }
                          selectTabOnKeyboard(event, tab.id);
                        }}
                        {...tabDrag.itemHandlers(tab.id)}
                      >
                        <TabFavicon tab={tab} animate={sidebarOnScreen} />
                        <span className="tab-title">{tab.title}</span>
                        {tab.private && (
                          <span
                            className="tab-private-badge"
                            title="Private tab"
                            aria-label="Private tab"
                          >
                            <PrivateGlyph />
                          </span>
                        )}
                        {tab.crashed && (
                          <span
                            className="tab-crashed-badge"
                            title="This tab crashed · it reloads when you open it"
                            aria-label="Crashed tab"
                          >
                            <svg
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              aria-hidden="true"
                            >
                              <path d="M12 3 2.5 20h19L12 3Z" />
                              <path d="M12 10v4" />
                              <path d="M12 17h.01" />
                            </svg>
                          </span>
                        )}
                        <TabAudioButton tab={tab} />
                        {castTabId === tab.id && <TabCastBadge />}
                        {tab.sleeping && (
                          <span
                            className={`tab-sleep-indicator${isRestoredSleep(tab.sleep) ? " is-restored" : ""}`}
                            title={describeTabSleep(tab.sleep)}
                            aria-label={`Sleeping tab: ${describeTabSleep(tab.sleep)}`}
                          >
                            ☾
                          </span>
                        )}
                        <button
                          className="tab-close"
                          type="button"
                          aria-label={`Close ${tab.title}`}
                          title="Close tab"
                          onClick={(event) => {
                            event.stopPropagation();
                            void window.api.browser.tabs.close(tab.id);
                          }}
                        >
                          ×
                        </button>
                      </div>
                    ))(entry)
                  ),
                )}
              {tabs.length === 0 && (
                <p className="sidebar-empty">No open tabs</p>
              )}
              <div className="sidebar-new-tab-actions">
                <button
                  className="sidebar-new-tab-row"
                  type="button"
                  aria-label="New tab"
                  title="New tab (Ctrl/⌘+T)"
                  onClick={createNewTab}
                >
                  <span className="sidebar-new-tab-row-icon" aria-hidden="true">
                    ＋
                  </span>
                  <span className="sidebar-new-tab-row-label">New Tab</span>
                </button>
                <button
                  className="sidebar-new-private-tab"
                  type="button"
                  aria-label="New private tab"
                  title="New private tab (Ctrl/⌘+Alt+N)"
                  onClick={() => void window.api.browser.tabs.createPrivate()}
                >
                  <PrivateGlyph />
                </button>
              </div>
            </div>
          )}
          {sidebarMode === "tabs" && (
            <ArchivedTabsSidebar
              cachedIcons={cachedSiteIcons}
              onOpened={() => setSidebarMode("tabs")}
            />
          )}

          {sidebarMode === "tabs" && spaces?.enabled && (
            <SpacesSwitcher snapshot={spaces} />
          )}
          <div className="sidebar-footer">
            {sidebarMode === "tabs" && (
              <button
                className={`sidebar-footer-icon-button sidebar-pin-button${sidebarPinned ? " is-current" : ""}`}
                type="button"
                aria-label={
                  sidebarPinned ? "Auto-hide sidebar" : "Keep sidebar open"
                }
                aria-pressed={sidebarPinned}
                title={
                  sidebarPinned ? "Auto-hide sidebar" : "Keep sidebar open"
                }
                onClick={() => setSidebarPinned((pinned: boolean) => !pinned)}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <rect x="3.5" y="5" width="17" height="14" rx="3" />
                  <path d="M9 5v14" />
                  {sidebarPinned ? (
                    <path d="m15.5 10-2 2 2 2" />
                  ) : (
                    <path d="m13.5 10 2 2-2 2" />
                  )}
                </svg>
              </button>
            )}
            <UpdateBadge />
            <button
              className={`sidebar-footer-icon-button${settingsTab ? " is-current" : ""}`}
              type="button"
              aria-label="Settings"
              aria-current={settingsTab ? "page" : undefined}
              title={`Settings (${window.api.platform === "darwin" ? "⌘," : "Ctrl+,"})`}
              onClick={openSettings}
            >
              <span aria-hidden="true">⚙</span>
            </button>
            <button
              className="sidebar-footer-icon-button sidebar-quit-button"
              type="button"
              aria-label="Quit Surffish"
              title="Quit Surffish"
              onClick={() => void window.api.browser.quit()}
            >
              <span aria-hidden="true">⏻</span>
            </button>
          </div>
        </div>
      </div>
      <div
        className="sidebar-resize-handle"
        role="separator"
        aria-label="Resize sidebar"
        aria-orientation="vertical"
        aria-valuemin={MIN_SIDEBAR_WIDTH}
        aria-valuemax={MAX_SIDEBAR_WIDTH}
        aria-valuenow={sidebarWidth}
        tabIndex={0}
        onPointerDown={beginSidebarResize}
        onPointerMove={moveSidebarResize}
        onPointerUp={finishSidebarResize}
        onPointerCancel={finishSidebarResize}
        onLostPointerCapture={finishSidebarResize}
        onKeyDown={handleSidebarResizeKeyDown}
      />
    </aside>
  );
}
