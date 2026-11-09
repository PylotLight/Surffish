import type { BrowserTabSummary, PinnedSite } from "../../../../shared/types";
import {
  MORPH_COLUMN_CLASS,
  MORPH_HIDDEN_CLASS,
  markOf,
} from "../../../../shared/sidebar-morph";
import { useLayoutEffect, useRef } from "react";
import { TabFavicon } from "../TabIndicators";
import { PinnedSiteIcon } from "./icons";
import { httpOrigin } from "./chrome-helpers";

/**
 * The collapsed sidebar's icon rail (Arc/Zen-style): pinned tabs and bookmarks first, then the
 * open tabs, with the sidebar pin at the bottom. It stays on
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
  /**
   * The panel is the current shape: the rail stays mounted (out of flow, invisible) so the
   * framework keeps drawing it, but it neither shows nor hit-tests.
   */
  shapeHidden: boolean;
  sidebarPinned: boolean;
  onOpenPinnedSite: (site: PinnedSite) => void;
  onUnpinPinnedSite: (site: PinnedSite) => void;
  onTogglePinned: () => void;
}

function RailTab({
  tab,
  animate,
  motionKey,
}: {
  tab: BrowserTabSummary;
  animate: boolean;
  /** Carries the mark from this rail item into its panel counterpart on a shape change. */
  motionKey: string;
}): React.JSX.Element {
  return (
    <button
      className={`sidebar-rail-item${tab.active ? " is-active" : ""}${tab.private ? " is-private" : ""}${tab.sleeping ? " is-sleeping" : ""}`}
      type="button"
      data-rail-tab-id={tab.id}
      data-motion-key={motionKey}
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

/**
 * Lines the rail's tab marks up with where the panel draws the same tabs, so collapsing or
 * expanding leaves each favicon where it was (the shape morph then has nothing to fly) instead of
 * the rail packing them from its own top edge. The panel stays mounted while the rail shows
 * (shared/sidebar-morph.ts), so its rows can be read in either shape.
 *
 * x: every rail mark shifts onto the panel favicons' centre line. y: each tab moves onto its
 * panel row, up by at most the gap before it, so a scrolled list or the taller pinned column just
 * packs the rail as before (and the morph carries the difference).
 */
function alignRailToPanel(rail: HTMLElement): void {
  const panel = rail.parentElement?.querySelector<HTMLElement>(
    ":scope > .sidebar-panel",
  );
  const items = [
    ...rail.querySelectorAll<HTMLElement>(
      ".sidebar-rail-item[data-motion-key]",
    ),
  ];
  for (const item of items) item.style.marginTop = "";
  if (!panel) return;
  const counterpart = (key: string): HTMLElement | null => {
    const row = panel.querySelector<HTMLElement>(
      `[data-motion-key="${CSS.escape(key)}"]`,
    );
    if (!row || row.getClientRects().length === 0) return null;
    return markOf(row);
  };
  const scroller = rail.querySelector<HTMLElement>(".sidebar-rail-scroll");
  const gap = scroller
    ? Number.parseFloat(getComputedStyle(scroller).rowGap) || 0
    : 0;
  const railBox = rail.getBoundingClientRect();
  const railCentre = railBox.left + railBox.width / 2;
  let shift: number | null = null;
  for (const item of items) {
    const key = item.dataset.motionKey;
    const target = key ? counterpart(key) : null;
    if (!target) continue;
    const to = target.getBoundingClientRect();
    if (shift === null) shift = Math.round(to.left + to.width / 2 - railCentre);
    const from = markOf(item).getBoundingClientRect();
    const dy = Math.round(
      to.top + to.height / 2 - (from.top + from.height / 2),
    );
    // Pulled up by at most the gap before it (the panel's rows sit closer than the rail's 44px
    // marks plus gap), never into the previous mark.
    const margin = Math.max(dy, -gap);
    if (margin !== 0) item.style.marginTop = `${margin}px`;
  }
  // Bounded so a mark never leaves the rail (a panel favicon is always near its left edge).
  if (shift !== null && Math.abs(shift) < railBox.width / 2 - 22)
    rail.style.setProperty("--sidebar-rail-mark-shift", `${shift}px`);
  else rail.style.removeProperty("--sidebar-rail-mark-shift");
}

export function SidebarRail({
  pinnedTabs,
  pinnedSites,
  tabs,
  cachedSiteIcons,
  animate,
  shapeHidden,
  sidebarPinned,
  onOpenPinnedSite,
  onUnpinPinnedSite,
  onTogglePinned,
}: SidebarRailProps): React.JSX.Element {
  const openTabs = tabs.filter((tab) => !tab.pinned);
  const hasPins = pinnedTabs.length > 0 || pinnedSites.length > 0;
  const railRef = useRef<HTMLElement>(null);
  // Before the sidebar's own layout effect plays the shape morph, so the marks it measures are
  // already where the rail draws them; only while the rail shows, so the panel pays nothing.
  useLayoutEffect(() => {
    if (!shapeHidden && railRef.current) alignRailToPanel(railRef.current);
  });
  return (
    <nav
      ref={railRef}
      className={`sidebar-rail ${MORPH_COLUMN_CLASS}${shapeHidden ? ` ${MORPH_HIDDEN_CLASS}` : ""}`}
      aria-label="Sidebar rail"
    >
      <div className="sidebar-rail-scroll" data-glide-scroller>
        {pinnedTabs.map((tab) => (
          <RailTab
            key={`pinned-tab:${tab.id}`}
            tab={tab}
            animate={animate}
            motionKey={`pin:${tab.id}`}
          />
        ))}
        {pinnedSites.map((site) => (
          <div
            className="sidebar-rail-site"
            key={`pinned-site:${site.url}`}
            data-motion-key={`site:${site.url}`}
          >
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
          <RailTab
            key={`tab:${tab.id}`}
            tab={tab}
            animate={animate}
            motionKey={`tab:${tab.id}`}
          />
        ))}
      </div>
      {/* Only the pin lives on the rail: hovering the rail reveals the panel, which covers any
       * other rail action before it can be clicked, and New tab / Settings are in the panel and
       * the toolbar anyway. The pin sits in a footer laid out exactly like the panel's, so it
       * stays on the same spot when the sidebar changes shape. */}
      <div className="sidebar-footer sidebar-rail-footer">
        <button
          className={`sidebar-footer-icon-button sidebar-pin-button sidebar-rail-pin${sidebarPinned ? " is-current" : ""}`}
          type="button"
          aria-label={sidebarPinned ? "Auto-hide sidebar" : "Keep sidebar open"}
          aria-pressed={sidebarPinned}
          title={sidebarPinned ? "Auto-hide sidebar" : "Keep sidebar open"}
          data-morph="sidebar-pin"
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
