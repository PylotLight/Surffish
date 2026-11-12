import type { BrowserTabSummary, PinnedSite } from "../../../../shared/types";
import {
  MORPH_COLUMN_CLASS,
  MORPH_HIDDEN_CLASS,
  markOf,
} from "../../../../shared/sidebar-morph";
import { useEffect, useLayoutEffect, useRef } from "react";
import { TabFavicon } from "../TabIndicators";
import { PinnedSiteMark } from "./icons";
import { planRailPinCluster } from "../../../../shared/rail-pin-cluster";
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
  /**
   * The pin cluster was clicked (or pressed from the keyboard): focus in the sidebar already
   * reveals the panel, and this hands focus on to its full pins row.
   */
  onRevealPins: () => void;
  onTogglePinned: () => void;
  onNewTab: () => void;
}

type RailPin =
  | { kind: "tab"; key: string; tab: BrowserTabSummary }
  | { kind: "site"; key: string; site: PinnedSite };

/**
 * Every pin as one rail row: marks stacked a little over each other (shared/rail-pin-cluster.ts)
 * in the panel's own order, the first in front and on the panel row's first pin, "+N" past four.
 * The active pin keeps its slot and is marked by its ring only. Each mark carries its pin's
 * motion key, so a shape change glides it between its slot here and its slot in the panel's row
 * (shared/sidebar-morph.ts). One button: hovering the rail reveals the panel over it, whose pins
 * row is where a specific pin is opened, dragged or removed, so the cluster never guesses which
 * pin a click meant.
 */
function RailPinCluster({
  pins,
  cachedSiteIcons,
  animate,
  onReveal,
}: {
  pins: RailPin[];
  cachedSiteIcons: Record<string, string>;
  animate: boolean;
  onReveal: () => void;
}): React.JSX.Element {
  const plan = planRailPinCluster(pins.length);
  const names = pins.map((pin) =>
    pin.kind === "tab" ? pin.tab.title : pin.site.title,
  );
  const label = `Pinned: ${names.join(", ")}`;
  const active = pins.some((pin) => pin.kind === "tab" && pin.tab.active);
  return (
    <button
      className={`sidebar-rail-pins${active ? " is-active" : ""}`}
      type="button"
      data-rail-align="pins"
      aria-label={label}
      title={label}
      draggable={false}
      style={{ "--rail-pins-width": `${plan.width}px` } as React.CSSProperties}
      onClick={onReveal}
    >
      {plan.slots.map((slot, index) => {
        const style = {
          "--rail-pin-x": `${slot.x}px`,
          "--rail-pin-slot": index,
          zIndex: slot.z,
        } as React.CSSProperties;
        const pin = slot.pin === null ? undefined : pins[slot.pin];
        if (!pin)
          return (
            <span
              key="more"
              className="sidebar-rail-pins-more"
              style={style}
              aria-hidden="true"
            >
              +{plan.overflow}
            </span>
          );
        return (
          <span
            key={pin.key}
            className={`sidebar-rail-pins-slot${pin.kind === "tab" && pin.tab.active ? " is-active" : ""}`}
            style={style}
            data-motion-key={pin.key}
            aria-hidden="true"
          >
            {pin.kind === "tab" ? (
              <TabFavicon tab={pin.tab} animate={animate} />
            ) : (
              <PinnedSiteMark
                site={pin.site}
                cachedFaviconUrl={
                  cachedSiteIcons[httpOrigin(pin.site.url) ?? ""] ?? null
                }
              />
            )}
          </span>
        );
      })}
    </button>
  );
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

/** The CSS margin a rail item has before alignRailToPanel nudges it (kept so a re-run can undo). */
const railBaseMargins = new WeakMap<HTMLElement, number>();

/** A px value from an inline style (`""` reads as 0). */
function inlinePx(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Sets `property` to `px` (or clears it for null), touching the style only when it changes. */
function setInlinePx(
  element: HTMLElement,
  property: string,
  px: number | null,
): boolean {
  const current = element.style.getPropertyValue(property);
  if (px === null) {
    if (!current) return false;
    element.style.removeProperty(property);
    return true;
  }
  if (current && Math.abs(inlinePx(current) - px) < 0.001) return false;
  element.style.setProperty(property, `${px}px`);
  return true;
}

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
 *
 * It runs on every render the rail is on screen for (a tab opening, closing, retitling), so it
 * reads every rect in one pass (one layout, the one the sidebar's morph snapshot needs anyway)
 * and works out where each mark would sit without the nudges it already carries, then writes only
 * the values that changed. Resetting the nudges and re-measuring mark by mark forced a layout per
 * rail item, which with a few dozen tabs put ~85ms of layout in front of every New Tab page's
 * first frame (perf: "New Tab page shown").
 */
function alignRailToPanel(rail: HTMLElement): void {
  // The panel's pin marks are destinations during a shape morph, not live targets. Re-aligning
  // against them while they travel shifts the rail underneath the flights and leaves pins adrift.
  if (rail.closest(".browser-sidebar")?.hasAttribute("data-reshaping")) return;
  const panel = rail.parentElement?.querySelector<HTMLElement>(
    ":scope > .sidebar-panel",
  );
  const items = [
    ...rail.querySelectorAll<HTMLElement>(
      ".sidebar-rail-pins-row [data-rail-align], .sidebar-rail-scroll > [data-motion-key], .sidebar-rail-scroll > .sidebar-rail-divider",
    ),
  ];
  const pin = rail.querySelector<HTMLElement>('[data-morph="sidebar-pin"]');
  if (!panel) {
    let changed = false;
    for (const item of items) {
      changed = setInlinePx(item, "margin-top", null) || changed;
      changed = setInlinePx(item, "--sidebar-rail-mark-dx", null) || changed;
    }
    if (pin?.style.translate) {
      pin.style.removeProperty("translate");
      changed = true;
    }
    changed = setInlinePx(rail, "--sidebar-rail-mark-shift", null) || changed;
    if (changed)
      rail.dispatchEvent(new Event("sidebar-rail-aligned", { bubbles: true }));
    return;
  }
  const counterpart = (item: HTMLElement): HTMLElement | null => {
    const key = item.dataset.motionKey;
    // The pin cluster lines up on the panel's pins row (its first mark exactly on the row's first
    // pin, x and y), so the hairline and every tab below line up too: pins take one row in both
    // shapes, and the first pin never moves between them.
    const row = item.classList.contains("sidebar-rail-divider")
      ? panel.querySelector<HTMLElement>(".sidebar-pinned-divider")
      : item.dataset.railAlign === "pins"
        ? panel.querySelector<HTMLElement>(
            ".sidebar-pinned-list > [data-motion-key]",
          )
        : key
          ? panel.querySelector<HTMLElement>(
              `[data-motion-key="${CSS.escape(key)}"]`,
            )
          : null;
    if (!row || row.getClientRects().length === 0) return null;
    return markOf(row);
  };

  // Read: every rect and style first, so the whole pass costs one layout.
  const scroller = rail.querySelector<HTMLElement>(".sidebar-rail-scroll");
  const gap = scroller
    ? Number.parseFloat(getComputedStyle(scroller).rowGap) || 0
    : 0;
  const railBox = rail.getBoundingClientRect();
  const appliedShift = inlinePx(
    rail.style.getPropertyValue("--sidebar-rail-mark-shift"),
  );
  // The column stacks its items, so an item sits lower by every margin nudge at or above it.
  let applied = 0;
  const measured = items.map((item) => {
    const rect = markOf(item).getBoundingClientRect();
    const dxNudge = item.style.getPropertyValue("--sidebar-rail-mark-dx");
    const translateX = dxNudge ? inlinePx(dxNudge) : appliedShift;
    const inlineMargin = item.style.marginTop;
    const base = inlineMargin
      ? (railBaseMargins.get(item) ?? inlinePx(inlineMargin))
      : Number.parseFloat(getComputedStyle(item).marginTop) || 0;
    if (inlineMargin) applied += inlinePx(inlineMargin) - base;
    const target = counterpart(item);
    return {
      item,
      base,
      // Where it would be drawn with no nudge of ours.
      from: new DOMRect(
        rect.x - translateX,
        rect.y - applied,
        rect.width,
        rect.height,
      ),
      to: target ? target.getBoundingClientRect() : null,
    };
  });
  let pinFrom: DOMRect | null = null;
  let pinTo: DOMRect | null = null;
  // The pin: both footers are laid out alike, but the panel's holds more buttons, so measure it
  // too rather than trusting the two flex rows to agree to the pixel.
  const pinTarget = panel.querySelector<HTMLElement>(
    '[data-morph="sidebar-pin"]',
  );
  if (pin && pinTarget && pinTarget.getClientRects().length > 0) {
    const rect = pin.getBoundingClientRect();
    const [tx = "", ty = ""] = pin.style.translate.split(/\s+/);
    pinFrom = new DOMRect(
      rect.x - inlinePx(tx),
      rect.y - inlinePx(ty),
      rect.width,
      rect.height,
    );
    pinTo = pinTarget.getBoundingClientRect();
  }

  // Work out: the column's line is the tab list's favicons (the first open tab, else the New
  // tab +). Pins sit on the same line in the panel (Browser.css), but only the first of their row
  // can line up.
  const line =
    measured.find(({ item }) => item.dataset.motionKey?.startsWith("tab:")) ??
    measured.find(({ item }) => item.dataset.motionKey === "new-tab");
  let shift = 0;
  if (line?.to) {
    shift = deviceOffset(line.from, line.to, "x");
    // Bounded so a mark never leaves the rail (a panel favicon is always near its left edge).
    if (Math.abs(shift) >= railBox.width / 2 - 22) shift = 0;
  }
  let moved = 0;
  const writes = measured.map(({ item, base, from: unnudged, to }) => {
    if (!to) return { item, base, dx: null, margin: null };
    const from = new DOMRect(
      unnudged.x + shift,
      unnudged.y + moved,
      unnudged.width,
      unnudged.height,
    );
    let dx: number | null = null;
    if (item.dataset.motionKey) {
      const offset = deviceOffset(from, to, "x");
      if (offset !== 0 && Math.abs(offset) <= MAX_MARK_NUDGE)
        dx = shift + offset;
    } else if (item.dataset.railAlign === "pins") {
      // The cluster is centred in the rail and its width follows the pin count, so its first mark
      // can sit further off the panel's first pin than a nudge: move it all the way, inside the
      // rail.
      const offset = deviceOffset(from, to, "x");
      if (offset !== 0 && Math.abs(shift + offset) < railBox.width / 2)
        dx = shift + offset;
    }
    const dy = deviceOffset(from, to, "y");
    // Pulled up by at most the gap before it (the panel's rows sit closer than the rail's 44px
    // marks plus gap), never into the previous mark. The pins row is outside that scroller, so use
    // its own top padding instead; otherwise its first pin can remain a couple of pixels too low.
    // The divider keeps its own CSS margin as the base, so it moves by exactly dy.
    const pullUpLimit =
      item.dataset.railAlign === "pins"
        ? Number.parseFloat(
            getComputedStyle(item.parentElement ?? rail).paddingTop,
          ) || gap
        : gap;
    const margin = Math.max(base + dy, -pullUpLimit);
    moved += margin - base;
    return { item, base, dx, margin: margin !== base ? margin : null };
  });
  let pinTranslate = "";
  if (pinFrom && pinTo) {
    const dx = deviceOffset(pinFrom, pinTo, "x");
    const dy = deviceOffset(pinFrom, pinTo, "y");
    if (
      (dx !== 0 || dy !== 0) &&
      Math.abs(dx) <= MAX_MARK_NUDGE &&
      Math.abs(dy) <= MAX_MARK_NUDGE
    )
      pinTranslate = `${dx}px ${dy}px`;
  }

  // Write: only what changed, so a render that moved nothing leaves layout clean.
  let changed = setInlinePx(
    rail,
    "--sidebar-rail-mark-shift",
    shift !== 0 ? shift : null,
  );
  for (const { item, base, dx, margin } of writes) {
    changed = setInlinePx(item, "--sidebar-rail-mark-dx", dx) || changed;
    if (margin === null) {
      if (item.style.marginTop) {
        item.style.marginTop = "";
        changed = true;
      }
      railBaseMargins.delete(item);
    } else {
      railBaseMargins.set(item, base);
      changed = setInlinePx(item, "margin-top", margin) || changed;
    }
  }
  if (pin && pin.style.translate !== pinTranslate) {
    if (pinTranslate) pin.style.translate = pinTranslate;
    else pin.style.removeProperty("translate");
    changed = true;
  }
  if (changed)
    rail.dispatchEvent(new Event("sidebar-rail-aligned", { bubbles: true }));
}

export function SidebarRail({
  pinnedTabs,
  pinnedSites,
  tabs,
  cachedSiteIcons,
  animate,
  shapeHidden,
  sidebarPinned,
  onRevealPins,
  onTogglePinned,
  onNewTab,
}: SidebarRailProps): React.JSX.Element {
  const openTabs = tabs.filter((tab) => !tab.pinned);
  const hasPins = pinnedTabs.length > 0 || pinnedSites.length > 0;
  const railRef = useRef<HTMLElement>(null);
  // Keep the rail aligned even while the panel is visible, so either direction starts on the
  // panel's current rows. `animate` is true only for a surface that paints the rail.
  const aligning = animate;
  useLayoutEffect(() => {
    if (aligning && railRef.current) alignRailToPanel(railRef.current);
  });
  // The panel's rows can move without the rail re-rendering (the window resizes, a web font lands),
  // so line up again then too, while the rail shows.
  useEffect(() => {
    if (!aligning) return;
    let frame = 0;
    let live = true;
    const rail = railRef.current;
    const panel = rail?.parentElement?.querySelector<HTMLElement>(
      ":scope > .sidebar-panel",
    );
    const card = rail?.closest(".browser-sidebar") ?? null;
    const realign = (): void => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (live && railRef.current) alignRailToPanel(railRef.current);
      });
    };
    const resizeObserver = new ResizeObserver(realign);
    if (rail) resizeObserver.observe(rail);
    if (panel) resizeObserver.observe(panel);
    if (card) resizeObserver.observe(card);
    const mutationObserver = new MutationObserver(realign);
    if (panel)
      mutationObserver.observe(panel, {
        attributes: true,
        attributeFilter: ["class", "style"],
        childList: true,
        subtree: true,
      });
    if (card)
      mutationObserver.observe(card, {
        attributes: true,
        attributeFilter: ["data-reshaping"],
      });
    window.addEventListener("resize", realign, { passive: true });
    if (document.fonts?.status === "loading")
      void document.fonts.ready.then(realign).catch(() => undefined);
    return () => {
      live = false;
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      window.removeEventListener("resize", realign);
    };
  }, [aligning]);
  return (
    <nav
      ref={railRef}
      className={`sidebar-rail ${MORPH_COLUMN_CLASS}${shapeHidden ? ` ${MORPH_HIDDEN_CLASS}` : ""}`}
      aria-label="Sidebar rail"
    >
      {/* Out of the tab list's scroller, like the panel's pins row: the cluster never scrolls away,
       * and a pin gliding to or from its panel slot is clipped only by the card's moving edge
       * (the scroller clips sideways at the rail's width). */}
      {hasPins && (
        <div className="sidebar-rail-pins-row">
          <RailPinCluster
            pins={[
              ...pinnedTabs.map((tab): RailPin => ({
                kind: "tab",
                key: `pin:${tab.id}`,
                tab,
              })),
              ...pinnedSites.map((site): RailPin => ({
                kind: "site",
                key: `site:${site.url}`,
                site,
              })),
            ]}
            cachedSiteIcons={cachedSiteIcons}
            animate={animate}
            onReveal={onRevealPins}
          />
        </div>
      )}
      <div className="sidebar-rail-scroll" data-glide-scroller>
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
