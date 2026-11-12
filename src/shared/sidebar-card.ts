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
    "--frame-surface": argbToCss(BROWSER_FRAME_SURFACE_ARGB),
    "--frame-surface-private": argbToCss(BROWSER_FRAME_SURFACE_PRIVATE_ARGB),
  };
}

/**
 * The browser frame's one surface colour, ARGB, opaque: rgb(25, 27, 31). The toolbar strip, the
 * rail, the docked panel and the hover panel all show exactly this colour, so they read as one
 * continuous frame with no seam in any state. Over live pages main sets it as the window root's
 * background (browser-shell.ts), under the toolbar strip, rail, docked panel and page card, which
 * draw no ground of their own there; the hover panel's native layer (sidebar-backdrop.ts) and the
 * solid fallback paint the same colour. It is opaque on purpose: a translucent tint over macOS
 * vibrancy reads as a wallpaper-dependent shade that no layer above the page can match (that was
 * the toolbar/hover-panel seam), so the frame trades vibrancy for one exact colour.
 */
export const BROWSER_FRAME_SURFACE_ARGB = "#FF191B1F";
/** The same frame in a private window: one opaque violet-tinted surface, rgb(30, 26, 40). */
export const BROWSER_FRAME_SURFACE_PRIVATE_ARGB = "#FF1E1A28";

/** The frame surface for a window (private windows get their own tint, still one surface). */
export function browserFrameSurfaceArgb(isPrivate: boolean): string {
  return isPrivate
    ? BROWSER_FRAME_SURFACE_PRIVATE_ARGB
    : BROWSER_FRAME_SURFACE_ARGB;
}

/** `#AARRGGBB` → CSS `rgb(r, g, b)` / `rgba(...)`, as getComputedStyle reports it. */
export function argbToCss(argb: string): string {
  const value = argb.replace(/^#/, "");
  const a = parseInt(value.slice(0, 2), 16);
  const r = parseInt(value.slice(2, 4), 16);
  const g = parseInt(value.slice(4, 6), 16);
  const b = parseInt(value.slice(6, 8), 16);
  return a === 255
    ? `rgb(${r}, ${g}, ${b})`
    : `rgba(${r}, ${g}, ${b}, ${Number((a / 255).toFixed(3))})`;
}
/**
 * Rounding of the live page card's corners (native View.setBorderRadius, real rounded corners):
 * where the sidebar meets the toolbar they read as the frame's rounded inner corner. A hover panel
 * slid out over the card hides the card's own left corners; its fillets (shared/frame-fillets.ts)
 * round the corner at the panel's edge with the same radius.
 */
export const PAGE_FRAME_RADIUS = 10;
