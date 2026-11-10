/**
 * The sidebar surface's frame geometry, in one place.
 *
 * The sidebar is drawn two ways: in-page by the content renderer (New Tab, full panels) and as its
 * own WebContentsView overlay above live pages. Both must put the surface on exactly the same window
 * pixels. Main uses these numbers for view bounds, and the renderer publishes them as CSS custom
 * properties on `.app-shell` (`sidebarCardCssVars`) so both renderings read the same values.
 */
export interface SidebarCardGeometry {
  /** Gap between the card and the top/bottom of the window (px). */
  inset: number;
  /**
   * Corner radius of the card's right side (px). 0: the sidebar is part of the browser frame (it
   * starts at the toolbar's bottom line, see browser-shell.ts), so it has no rounded corner of its
   * own to poke out at the toolbar; the page card beside it carries the frame's rounded inner
   * corners (PAGE_FRAME_RADIUS). The native view clips uniformly with this number (Electron has no
   * per-corner radius), so anything above 0 would round its top-left at the frame too.
   */
  radius: number;
  /** The card never gets wider than the window minus this (px). */
  windowGutter: number;
  /** Card border width (px). */
  borderWidth: number;
  /** Left position of the macOS traffic-light dots, measured from the window edge (px). */
  controlsLeft: number;
  /**
   * Top position of the macOS traffic-light dots, measured from the window edge (px): centred on
   * the toolbar strip (50px on macOS), which holds them now the sidebar starts below it.
   */
  controlsTop: number;
  /**
   * Width of the collapsed sidebar's icon rail (px). The card never gets narrower than this, so a
   * collapsed sidebar still shows its icons (the panel is clipped beside the rail). Wide enough
   * for the macOS window-control row (16px inset + three 13px dots + gaps ends at 74px), with
   * room to spare.
   */
  railWidth: number;
}

export const SIDEBAR_CARD: Readonly<SidebarCardGeometry> = Object.freeze({
  inset: 0,
  radius: 0,
  windowGutter: 48,
  borderWidth: 0,
  controlsLeft: 16,
  controlsTop: 18,
  railWidth: 84,
});

/** Paint that both surfaces share. Only inset shadows: an outer shadow would be clipped away at the overlay view's edge. */
export const SIDEBAR_CARD_BORDER_COLOR = "rgba(255, 255, 255, 0.18)";
export const SIDEBAR_CARD_SHADOW = "inset -1px 0 rgba(255, 255, 255, 0.12)";

export interface CardRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Top/bottom inset actually used for a window this tall (tiny windows give the card most of the height). */
export function sidebarCardInset(
  windowHeight: number,
  geometry: SidebarCardGeometry = SIDEBAR_CARD,
): number {
  return Math.max(
    0,
    Math.min(geometry.inset, Math.floor(Math.max(0, windowHeight) / 4)),
  );
}

/** Widest the card (and the overlay view holding it) may be in a window this wide. */
export function sidebarCardMaxWidth(
  windowWidth: number,
  geometry: SidebarCardGeometry = SIDEBAR_CARD,
): number {
  return Math.max(0, windowWidth - geometry.windowGutter);
}

/** Width of the card when the panel is collapsed to its icon rail (never wider than the card may get). */
export function sidebarRailWidth(
  windowWidth: number,
  geometry: SidebarCardGeometry = SIDEBAR_CARD,
): number {
  return Math.min(
    geometry.railWidth,
    sidebarCardMaxWidth(windowWidth, geometry),
  );
}

/** Where the card sits in window coordinates (border box), for a given window size and sidebar width. */
export function sidebarCardRect(
  {
    windowWidth,
    windowHeight,
    sidebarWidth,
  }: { windowWidth: number; windowHeight: number; sidebarWidth: number },
  geometry: SidebarCardGeometry = SIDEBAR_CARD,
): CardRect {
  const inset = sidebarCardInset(windowHeight, geometry);
  return {
    x: 0,
    y: inset,
    width: Math.max(
      0,
      Math.min(sidebarWidth, sidebarCardMaxWidth(windowWidth, geometry)),
    ),
    height: Math.max(0, windowHeight - inset * 2),
  };
}

/** CSS custom properties the renderer sets on `.app-shell`; the sidebar CSS reads only these. */
export function sidebarCardCssVars(
  geometry: SidebarCardGeometry = SIDEBAR_CARD,
): Record<string, string> {
  return {
    "--sidebar-card-inset": `${geometry.inset}px`,
    "--sidebar-card-radius": `${geometry.radius}px`,
    "--sidebar-card-gutter": `${geometry.windowGutter}px`,
    "--sidebar-rail-width": `${geometry.railWidth}px`,
    "--sidebar-card-border-width": `${geometry.borderWidth}px`,
    "--sidebar-card-border-color": SIDEBAR_CARD_BORDER_COLOR,
    "--sidebar-card-shadow": SIDEBAR_CARD_SHADOW,
    "--sidebar-controls-left": `${geometry.controlsLeft}px`,
    "--sidebar-controls-top": `${geometry.controlsTop}px`,
  };
}

/**
 * The browser frame's tint, ARGB: rgba(18, 21, 25, 0.82), the toolbar strip's own ground
 * (.browser-chrome in Browser.css). Over live pages main sets it as the window root's background
 * (browser-shell.ts), under the toolbar strip, the rail, the docked panel and the page card, which
 * draw none of their own there: one material, the macOS window vibrancy (or the window colour
 * elsewhere) under one tint, showing in the gaps and the card's rounded cut-out corners too.
 */
export const BROWSER_FRAME_TINT_ARGB = "#D1121519";
/**
 * Rounding of the live page card's corners (native View.setBorderRadius, real rounded corners):
 * where the sidebar meets the toolbar they read as the frame's rounded inner corner.
 */
export const PAGE_FRAME_RADIUS = 10;
