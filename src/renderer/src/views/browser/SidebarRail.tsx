import type { BrowserTabSummary, PinnedSite } from "../../../../shared/types";
import { TabFavicon } from "../TabIndicators";
import { PinnedSiteIcon } from "./icons";
import { httpOrigin } from "./chrome-helpers";

/**
 * The collapsed sidebar's icon rail (Arc/Zen-style): pinned tabs and bookmarks first, then the
 * open tabs, with the actions that would otherwise be hidden in the panel's footer. It stays on
 * screen when the panel is collapsed, so the sidebar is never an empty edge.
 *
 * Rail items deliberately do NOT carry `data-browser-tab-id` / `data-pin-id`: those select the one
 * canonical row in the panel (drag-sort, automation, smokes), and a second copy would shadow it.
 */
export interface SidebarRailProps {
  /** Pinned tabs in pin order (already resolved from the saved id order). */
  pinnedTabs: BrowserTabSummary[];
  /** Pinned bookmarks in pin order (already resolved from the saved url order). */
  pinnedSites: PinnedSite[];
  /** Every open tab in sidebar order, pinned ones included. */
  tabs: BrowserTabSummary[];
  cachedSiteIcons: Record<string, string>;
  /** Whether a tab's loading spinner may animate (false when this surface is off screen). */
  animate: boolean;
  sidebarPinned: boolean;
  onOpenPinnedSite: (site: PinnedSite) => void;
  onUnpinPinnedSite: (site: PinnedSite) => void;
  onCreateTab: () => void;
  onCreatePrivateTab: () => void;
  onOpenSettings: () => void;
  onTogglePinned: () => void;
}

function RailTab({
  tab,
  animate,
}: {
  tab: BrowserTabSummary;
  animate: boolean;
}): React.JSX.Element {
  return (
    <button
      className={`sidebar-rail-item${tab.active ? " is-active" : ""}${tab.private ? " is-private" : ""}${tab.sleeping ? " is-sleeping" : ""}`}
      type="button"
      data-rail-tab-id={tab.id}
      aria-label={`${tab.title}${tab.active ? " (current tab)" : ""}`}
      aria-current={tab.active ? "page" : undefined}
      title={tab.title}
      onClick={() => void window.api.browser.tabs.activate(tab.id)}
      onMouseDown={(event) => {
        if (event.button === 1) event.preventDefault();
      }}
      onAuxClick={(event) => {
        if (event.button !== 1) return;
        event.preventDefault();
        void window.api.browser.tabs.close(tab.id);
      }}
    >
      <TabFavicon tab={tab} animate={animate} />
      {tab.sleeping && (
        <span className="sidebar-rail-badge" aria-hidden="true">
          ☾
        </span>
      )}
      {(tab.audible || tab.muted) && (
        <span
          className={`sidebar-rail-badge is-audio${tab.muted ? " is-muted" : ""}`}
          aria-hidden="true"
        >
          ♪
        </span>
      )}
    </button>
  );
}

export function SidebarRail({
  pinnedTabs,
  pinnedSites,
  tabs,
  cachedSiteIcons,
  animate,
  sidebarPinned,
  onOpenPinnedSite,
  onUnpinPinnedSite,
  onCreateTab,
  onCreatePrivateTab,
  onOpenSettings,
  onTogglePinned,
}: SidebarRailProps): React.JSX.Element {
  const openTabs = tabs.filter((tab) => !tab.pinned);
  const hasPins = pinnedTabs.length > 0 || pinnedSites.length > 0;
  return (
    <nav className="sidebar-rail" aria-label="Sidebar rail">
      <div className="sidebar-rail-scroll">
        {pinnedTabs.map((tab) => (
          <RailTab key={`pinned-tab:${tab.id}`} tab={tab} animate={animate} />
        ))}
        {pinnedSites.map((site) => (
          <div className="sidebar-rail-site" key={`pinned-site:${site.url}`}>
            <PinnedSiteIcon
              site={site}
              cachedFaviconUrl={
                cachedSiteIcons[httpOrigin(site.url) ?? ""] ?? null
              }
              onOpen={() => onOpenPinnedSite(site)}
              onUnpin={() => onUnpinPinnedSite(site)}
            />
          </div>
        ))}
        {hasPins && openTabs.length > 0 && (
          <div className="sidebar-rail-divider" aria-hidden="true" />
        )}
        {openTabs.map((tab) => (
          <RailTab key={`tab:${tab.id}`} tab={tab} animate={animate} />
        ))}
      </div>
      <div className="sidebar-rail-actions">
        <button
          className="sidebar-rail-action"
          type="button"
          aria-label="New tab"
          title="New tab (Ctrl/⌘+T)"
          onClick={onCreateTab}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
        <button
          className="sidebar-rail-action"
          type="button"
          aria-label="New private tab"
          title="New private tab (Ctrl/⌘+Alt+N)"
          onClick={onCreatePrivateTab}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 3 4 6v5.5c0 4.6 3.2 8 8 9.5 4.8-1.5 8-4.9 8-9.5V6l-8-3Z" />
          </svg>
        </button>
        <button
          className="sidebar-rail-action"
          type="button"
          aria-label="Settings"
          title={`Settings (${window.api.platform === "darwin" ? "⌘," : "Ctrl+,"})`}
          onClick={onOpenSettings}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="3.2" />
            <path d="M12 3.5v2M12 18.5v2M3.5 12h2M18.5 12h2M6 6l1.4 1.4M16.6 16.6 18 18M18 6l-1.4 1.4M7.4 16.6 6 18" />
          </svg>
        </button>
        <button
          className={`sidebar-rail-action sidebar-rail-pin${sidebarPinned ? " is-current" : ""}`}
          type="button"
          aria-label={sidebarPinned ? "Auto-hide sidebar" : "Keep sidebar open"}
          aria-pressed={sidebarPinned}
          title={sidebarPinned ? "Auto-hide sidebar" : "Keep sidebar open"}
          onClick={onTogglePinned}
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
      </div>
    </nav>
  );
}
