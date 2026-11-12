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
    "--frame-glass": argbToCss(BROWSER_FRAME_GLASS_ARGB),
    "--frame-glass-private": argbToCss(BROWSER_FRAME_GLASS_PRIVATE_ARGB),
    "--frame-glass-light": argbToCss(BROWSER_FRAME_GLASS_LIGHT_ARGB),
    "--frame-glass-light-private": argbToCss(
      BROWSER_FRAME_GLASS_LIGHT_PRIVATE_ARGB,
    ),
    "--sidebar-hover-glass": argbToCss(SIDEBAR_HOVER_GLASS_ARGB),
    "--sidebar-hover-glass-private": argbToCss(
      SIDEBAR_HOVER_GLASS_PRIVATE_ARGB,
    ),
    "--sidebar-float-gap": `${SIDEBAR_FLOAT.gap}px`,
    "--sidebar-float-radius": `${SIDEBAR_FLOAT.radius}px`,
  };
}

/**
 * The browser frame's opaque surface colour, ARGB: rgb(25, 27, 31). It is the frame wherever there
 * is no glass: Linux and Windows (no vibrancy), macOS with Reduce Transparency on, native
 * fullscreen, and the solid hover-panel fallback (Sidebar blur off). Over live pages main sets the
 * frame's ground (this, or the glass tint below) as the window root's background (browser-shell.ts),
 * under the toolbar strip, rail, docked panel and page card, which draw no ground of their own
 * there, so the toolbar, rail and docked panel are always one surface with no seam.
 */
export const BROWSER_FRAME_SURFACE_ARGB = "#FF191B1F";
/** The same frame in a private window: one opaque violet-tinted surface, rgb(30, 26, 40). */
export const BROWSER_FRAME_SURFACE_PRIVATE_ARGB = "#FF1E1A28";

/**
 * macOS glass (Zephium's look): the window's own NSVisualEffectView ('sidebar' material, the one
 * Zephium installs in desktop/src/material.rs) under a light translucent wash. Zephium leaves the
 * material untinted by default; the dark sidebar material is already a deep grey, so any heavy dark
 * tint over it reads as a flat, opaque #1B1D21 (that was the 0.55 wash). In dark appearance the wash
 * is rgba(18, 21, 25, 0.2): the wallpaper's colour and blur read through, the white toolbar text
 * still reads on the dark material. Toolbar, rail and docked panel all sit on the one window root
 * that carries it, so they stay a single surface.
 */
export const BROWSER_FRAME_GLASS_ARGB = "#33121519";
/** The glass frame in a private window: the private violet, a little stronger so it still reads. */
export const BROWSER_FRAME_GLASS_PRIVATE_ARGB = "#4D1E1A28";
/**
 * Light appearance: the sidebar material turns pale and the chrome's text is white, so the wash is
 * heavier (0.7) to keep it legible; still glass, the wallpaper tints it.
 */
export const BROWSER_FRAME_GLASS_LIGHT_ARGB = "#B3121519";
export const BROWSER_FRAME_GLASS_LIGHT_PRIVATE_ARGB = "#B31E1A28";

/**
 * The floating hover card's tint over the page (macOS glass): the frame surface colour at 0.75,
 * over the native hover layer's in-window blur (SIDEBAR_HOVER_GLASS_BLUR). Denser than the frame
 * tint because there is no dark system material under it, only the page.
 */
export const SIDEBAR_HOVER_GLASS_ARGB = "#BF191B1F";
export const SIDEBAR_HOVER_GLASS_PRIVATE_ARGB = "#BF1E1A28";

/** The frame surface for a window (private windows get their own tint, still one surface). */
export function browserFrameSurfaceArgb(isPrivate: boolean): string {
  return isPrivate
    ? BROWSER_FRAME_SURFACE_PRIVATE_ARGB
    : BROWSER_FRAME_SURFACE_ARGB;
}

/**
 * Whether the frame is glass right now: macOS only (the window has vibrancy), never with Reduce
 * Transparency on, never in native fullscreen (no frame; the strip slides over the page).
 */
export function browserFrameIsGlass({
  platform,
  reducedTransparency,
  fullscreen,
}: {
  platform: NodeJS.Platform | string;
  reducedTransparency: boolean;
  fullscreen: boolean;
}): boolean {
  return platform === "darwin" && !reducedTransparency && !fullscreen;
}

/** The frame's ground over live pages: the glass tint, or the opaque surface without glass. */
export function browserFrameGroundArgb({
  isPrivate,
  glass,
  dark = true,
}: {
  isPrivate: boolean;
  glass: boolean;
  /** The system appearance (the vibrancy material follows it): dark unless told otherwise. */
  dark?: boolean;
}): string {
  if (!glass) return browserFrameSurfaceArgb(isPrivate);
  if (!dark)
    return isPrivate
      ? BROWSER_FRAME_GLASS_LIGHT_PRIVATE_ARGB
      : BROWSER_FRAME_GLASS_LIGHT_ARGB;
  return isPrivate
    ? BROWSER_FRAME_GLASS_PRIVATE_ARGB
    : BROWSER_FRAME_GLASS_ARGB;
}

/** The floating hover card's ground: glass tint (blurred page under it) or the opaque surface. */
export function sidebarHoverCardArgb({
  isPrivate,
  glass,
}: {
  isPrivate: boolean;
  glass: boolean;
}): string {
  if (!glass) return browserFrameSurfaceArgb(isPrivate);
  return isPrivate
    ? SIDEBAR_HOVER_GLASS_PRIVATE_ARGB
    : SIDEBAR_HOVER_GLASS_ARGB;
}

/**
 * The hover-revealed panel is a floating card, not part of the frame (Zephium's hidden-sidebar
 * card): it stands `gap` px off the toolbar's bottom line and the window's left and bottom edges,
 * with its own rounded corners and a soft shadow, so it never shares an edge with the toolbar and
 * no seam can show. The overlay view itself keeps its frame bounds (x 0, from the toolbar's line to
 * the bottom; one `gap` wider so the card keeps the sidebar width), so the pointer never falls into
 * a hole between the rail and the card; the renderer insets its card by `gap` and main insets the
 * native glass layer and shadow the same way.
 */
export const SIDEBAR_FLOAT = Object.freeze({ gap: 6, radius: 12 });

/** The floating card's window rect inside the overlay view's bounds. */
export function sidebarFloatCardRect(
  view: CardRect,
  float: { gap: number } = SIDEBAR_FLOAT,
): CardRect {
  const gap = Math.max(0, float.gap);
  return {
    x: view.x + gap,
    y: view.y + gap,
    width: Math.max(0, view.width - gap),
    height: Math.max(0, view.height - gap * 2),
  };
}

/**
 * The floating card's soft shadow as a few stacked translucent rounded layers (cheap solid-colour
 * compositor layers, no blur; they follow the card's bounds every frame of the slide). Offset down
 * and right, so the top and left gaps stay the frame's own colour; widest layer faintest.
 */
const SIDEBAR_FLOAT_SHADOW: readonly {
  spread: number;
  alpha: number;
}[] = Object.freeze([
  { spread: 2, alpha: 0.1 },
  { spread: 5, alpha: 0.07 },
  { spread: 9, alpha: 0.05 },
  { spread: 14, alpha: 0.03 },
]);
const SHADOW_DROP = 2;

/** Each shadow layer's rect and corner radius around a floating card rect. */
export function sidebarFloatShadowRects(
  card: CardRect,
  radius: number = SIDEBAR_FLOAT.radius,
): (CardRect & { radius: number; alpha: number })[] {
  if (card.width <= 0 || card.height <= 0) return [];
  return SIDEBAR_FLOAT_SHADOW.map(({ spread, alpha }) => ({
    x: card.x,
    y: card.y + SHADOW_DROP,
    width: card.width + spread,
    height: card.height + spread - SHADOW_DROP,
    radius: radius + spread,
    alpha,
  }));
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
 * where the sidebar meets the toolbar they read as the frame's rounded inner corner, against the
 * glass (macOS) or the opaque frame. The hover panel floats over the card as its own rounded card
 * (SIDEBAR_FLOAT), so it needs no corner pieces of its own.
 */
export const PAGE_FRAME_RADIUS = 10;
