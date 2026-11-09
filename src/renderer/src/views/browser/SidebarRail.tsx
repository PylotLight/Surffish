import type { BrowserTabSummary, PinnedSite } from "../../../../shared/types";
import {
  MORPH_COLUMN_CLASS,
  MORPH_HIDDEN_CLASS,
  markOf,
} from "../../../../shared/sidebar-morph";
import { useEffect, useLayoutEffect, useRef } from "react";
import { TabFavicon } from "../TabIndicators";
import { PinnedSiteIcon } from "./icons";
import { httpOrigin } from "./chrome-helpers";

/**
 * The collapsed sidebar's icon rail (Arc/Zen-style): pinned tabs and bookmarks first, then the
 * open tabs and a New tab +, with the sidebar pin at the bottom. It stays on
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
  onNewTab: () => void;
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

/** `value` on this display's pixel grid, the position the compositor actually paints it at. */
function onDevicePixels(value: number): number {
  const ratio = window.devicePixelRatio || 1;
  return Math.round(value * ratio) / ratio;
}

/**
 * How far `from` must move to be painted on the same device pixels as `to`. Rects of the same
 * size line up edge on edge (each is snapped to the grid where it is painted, so their centres
 * can never land half a pixel apart); otherwise their centres meet.
 */
function deviceOffset(from: DOMRect, to: DOMRect, axis: "x" | "y"): number {
  const [fromStart, fromSize, toStart, toSize] =
    axis === "x"
      ? [from.left, from.width, to.left, to.width]
      : [from.top, from.height, to.top, to.height];
  if (Math.abs(fromSize - toSize) < 0.01)
    return onDevicePixels(toStart) - onDevicePixels(fromStart);
  return onDevicePixels(toStart + toSize / 2 - (fromStart + fromSize / 2));
}

/** Further than this, a counterpart is somewhere the rail column cannot follow (the pins' row). */
const MAX_MARK_NUDGE = 3;

/**
 * Lines the rail's marks up with where the panel draws the same things, so collapsing or
 * expanding leaves each favicon (and the New tab +, and the sidebar pin) on exactly the device
 * pixels it was on instead of the rail packing them from its own top edge. The panel stays
 * mounted at its open width while the rail shows (shared/sidebar-morph.ts, Browser.css), so its
 * rows read the same in either shape.
 *
 * Every offset is measured, not assumed, and kept on the device-pixel grid rather than rounded
 * to whole CSS pixels: the panel's 41px tab rows put each favicon's top on a half pixel, and a
 * whole-pixel nudge left every rail favicon one device pixel off its panel counterpart at 2x (the
 * "everything moves 1px" on collapse/expand). x: the column shifts onto the tab list's favicon
 * line, and a mark whose counterpart sits a little off it is nudged onto it. y: each mark moves
 * onto its panel row, and the pins/tabs hairline onto the panel's, up by at most the gap before
 * it, so a scrolled list or the pins' row just packs the rail as before.
 */
function alignRailToPanel(rail: HTMLElement): void {
  const panel = rail.parentElement?.querySelector<HTMLElement>(
    ":scope > .sidebar-panel",
  );
  const items = [
    ...rail.querySelectorAll<HTMLElement>(
      ".sidebar-rail-scroll > [data-motion-key], .sidebar-rail-scroll > .sidebar-rail-divider",
    ),
  ];
  const pin = rail.querySelector<HTMLElement>('[data-morph="sidebar-pin"]');
  for (const item of items) {
    item.style.marginTop = "";
    item.style.removeProperty("--sidebar-rail-mark-dx");
  }
  pin?.style.removeProperty("translate");
  rail.style.removeProperty("--sidebar-rail-mark-shift");
  if (!panel) return;
  const counterpart = (item: HTMLElement): HTMLElement | null => {
    const key = item.dataset.motionKey;
    const row = item.classList.contains("sidebar-rail-divider")
      ? panel.querySelector<HTMLElement>(".sidebar-pinned-divider")
      : key
        ? panel.querySelector<HTMLElement>(
            `[data-motion-key="${CSS.escape(key)}"]`,
          )
        : null;
    if (!row || row.getClientRects().length === 0) return null;
    return markOf(row);
  };
  const scroller = rail.querySelector<HTMLElement>(".sidebar-rail-scroll");
  const gap = scroller
    ? Number.parseFloat(getComputedStyle(scroller).rowGap) || 0
    : 0;
  const railBox = rail.getBoundingClientRect();
  // The column's line: the tab list's favicons (the first open tab, else the New tab +). Pins sit
  // on the same line in the panel (Browser.css), but only the first of their row can line up.
  const lineItem =
    items.find((item) => item.dataset.motionKey?.startsWith("tab:")) ??
    items.find((item) => item.dataset.motionKey === "new-tab");
  const lineTarget = lineItem ? counterpart(lineItem) : null;
  let shift = 0;
  if (lineItem && lineTarget) {
    shift = deviceOffset(
      markOf(lineItem).getBoundingClientRect(),
      lineTarget.getBoundingClientRect(),
      "x",
    );
    // Bounded so a mark never leaves the rail (a panel favicon is always near its left edge).
    if (Math.abs(shift) < railBox.width / 2 - 22)
      rail.style.setProperty("--sidebar-rail-mark-shift", `${shift}px`);
    else shift = 0;
  }
  for (const item of items) {
    const target = counterpart(item);
    if (!target) continue;
    const to = target.getBoundingClientRect();
    const from = markOf(item).getBoundingClientRect();
    if (item.dataset.motionKey) {
      const dx = deviceOffset(from, to, "x");
      if (dx !== 0 && Math.abs(dx) <= MAX_MARK_NUDGE)
        item.style.setProperty("--sidebar-rail-mark-dx", `${shift + dx}px`);
    }
    const dy = deviceOffset(from, to, "y");
    // Pulled up by at most the gap before it (the panel's rows sit closer than the rail's 44px
    // marks plus gap), never into the previous mark. The divider keeps its own CSS margin as the
    // base, so it moves by exactly dy.
    const base = Number.parseFloat(getComputedStyle(item).marginTop) || 0;
    const margin = Math.max(base + dy, -gap);
    if (margin !== base) item.style.marginTop = `${margin}px`;
  }
  // The pin: both footers are laid out alike, but the panel's holds more buttons, so measure it
  // too rather than trusting the two flex rows to agree to the pixel.
  const pinTarget = panel.querySelector<HTMLElement>(
    '[data-morph="sidebar-pin"]',
  );
  if (pin && pinTarget && pinTarget.getClientRects().length > 0) {
    const from = pin.getBoundingClientRect();
    const to = pinTarget.getBoundingClientRect();
    const dx = deviceOffset(from, to, "x");
    const dy = deviceOffset(from, to, "y");
    if (
      (dx !== 0 || dy !== 0) &&
      Math.abs(dx) <= MAX_MARK_NUDGE &&
      Math.abs(dy) <= MAX_MARK_NUDGE
    )
      pin.style.translate = `${dx}px ${dy}px`;
  }
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
  onNewTab,
}: SidebarRailProps): React.JSX.Element {
  const openTabs = tabs.filter((tab) => !tab.pinned);
  const hasPins = pinnedTabs.length > 0 || pinnedSites.length > 0;
  const railRef = useRef<HTMLElement>(null);
  // Before the sidebar's own layout effect plays the shape morph, so the marks it measures are
  // already where the rail draws them; only while the rail shows, so the panel pays nothing.
  useLayoutEffect(() => {
    if (!shapeHidden && railRef.current) alignRailToPanel(railRef.current);
  });
  // The panel's rows can move without the rail re-rendering (the window resizes, a web font lands),
  // so line up again then too, while the rail shows.
  useEffect(() => {
    if (shapeHidden) return;
    let frame = 0;
    const realign = (): void => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (railRef.current) alignRailToPanel(railRef.current);
      });
    };
    window.addEventListener("resize", realign, { passive: true });
    void document.fonts?.ready.then(realign).catch(() => undefined);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", realign);
    };
  }, [shapeHidden]);
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
        {/* The pins/tabs hairline: shown exactly when the panel shows its own (whenever anything
         * is pinned), aligned onto the panel's line, and crossfaded with it by the morph. */}
        {hasPins && <div className="sidebar-rail-divider" aria-hidden="true" />}
        {openTabs.map((tab) => (
          <RailTab
            key={`tab:${tab.id}`}
            tab={tab}
            animate={animate}
            motionKey={`tab:${tab.id}`}
          />
        ))}
        {/* Keyed to the panel's New Tab row: the + is the same mark on the same spot
         * (alignRailToPanel), so it holds while "New Tab" fades in beside it. Hovering the rail
         * reveals the panel over it, and that row covers this spot, so a click lands on New Tab in
         * either shape. */}
        <button
          className="sidebar-rail-item sidebar-rail-new-tab"
          type="button"
          data-motion-key="new-tab"
          aria-label="New tab"
          title="New tab (Ctrl/⌘+T)"
          onClick={onNewTab}
        >
          <span className="sidebar-new-tab-row-icon" aria-hidden="true">
            ＋
          </span>
        </button>
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
