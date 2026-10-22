/**
 * The sidebar card's geometry, in one place.
 *
 * The sidebar is drawn two ways: in-page by the content renderer (New Tab, full panels) and as its
 * own WebContentsView overlay above live pages (optionally inset + rounded by main for the native
 * blur). Both must put the card on exactly the same window pixels, so main reads these numbers for
 * the view bounds and the renderer publishes them as CSS custom properties on `.app-shell`
 * (`sidebarCardCssVars`), which every sidebar rule in the CSS uses instead of literals.
 */
export interface SidebarCardGeometry {
  /** Gap between the card and the top/bottom of the window (px). */
  inset: number;
  /** Corner radius of the card (and of the native-blur view). */
  radius: number;
  /** The card never gets wider than the window minus this (px). */
  windowGutter: number;
  /** Card border width (px). */
  borderWidth: number;
  /** Top of the macOS window-control row, measured from the top of the window (px). */
  controlsTop: number;
}

export const SIDEBAR_CARD: Readonly<SidebarCardGeometry> = Object.freeze({
  inset: 10,
  radius: 28,
  windowGutter: 48,
  borderWidth: 1,
  controlsTop: 13,
});

/** Paint that both surfaces share. Only inset shadows: an outer shadow would be clipped away at the overlay view's edge. */
export const SIDEBAR_CARD_BORDER_COLOR = "rgba(255, 255, 255, 0.18)";
export const SIDEBAR_CARD_SHADOW =
  "inset 0 1px rgba(255, 255, 255, 0.14), inset -1px 0 rgba(255, 255, 255, 0.08)";

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
    "--sidebar-card-border-width": `${geometry.borderWidth}px`,
    "--sidebar-card-border-color": SIDEBAR_CARD_BORDER_COLOR,
    "--sidebar-card-shadow": SIDEBAR_CARD_SHADOW,
    "--sidebar-controls-top": `${geometry.controlsTop}px`,
  };
}
