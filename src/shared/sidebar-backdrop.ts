import {
  DEFAULT_SIDEBAR_PUSH_STYLE,
  normalizeSidebarPushStyle,
  type SidebarPushStyle,
} from "./page-view-bounds";
/**
 * How the hover/pinned overlay sidebar gets a legible background over a live page.
 *
 * The overlay sidebar is its own transparent WebContentsView stacked above the page's
 * WebContentsView, so CSS backdrop-filter inside it only ever sees its own (empty) layer, and
 * window vibrancy (NSVisualEffectView) sits *behind* the page view, so it can't reach either.
 * The three paths that do work:
 *  - 'native':   View.setBackgroundBlur (Electron 44): a live blur in the Chromium Views compositor.
 *                This remains available for explicit tests, but macOS WebContentsView page pixels
 *                use native Cocoa surfaces that are not reliably behind this compositor layer.
 *  - 'snapshot': capture the page strip under the sidebar when it opens (and again on tab switch /
 *                navigation, throttled), shrink it, blur it once in a canvas, darken it. macOS uses
 *                this path by default so the blur is painted in the sidebar's own WebContentsView.
 *  - 'solid':    a near-opaque tint. Always used when "Sidebar blur" is off.
 */
import {
  FRAME_TRANSPARENCY_DEFAULT,
  normalizeFrameTransparency,
} from "./sidebar-card";

export type SidebarBackdropMode = "native" | "snapshot" | "solid";

export const SIDEBAR_BACKDROP_MODES: readonly SidebarBackdropMode[] = [
  "native",
  "snapshot",
  "solid",
];

export interface SidebarBackdropSettings {
  /** Settings → General → Appearance → Sidebar blur. On by default. */
  blur: boolean;
  /**
   * Settings → General → Appearance → Frame transparency (macOS glass): 0 solid … 100 clearest,
   * FRAME_TRANSPARENCY_DEFAULT the stock look. Maps to the frame and hover-card tints in
   * shared/sidebar-card.ts (frameGlassTints).
   */
  frameTransparency: number;
  /**
   * Settings → General → Appearance → Sidebar pushes page. On (default): the tab list's hover panel
   * pushes the page card aside (Sidebar animation says how) and is the frame's own
   * material, like the docked panel. Off: the panel floats over the page as its own card (blur,
   * tint, shadow), the earlier look, kept to compare against.
   */
  sidebarPushesPage: boolean;
  /**
   * Settings → General → Appearance → Sidebar animation (only while the sidebar pushes the page):
   * 'resize' shrinks the page from the left as the panel opens, 'slide' moves it right at its size.
   */
  sidebarPushStyle: SidebarPushStyle;
}

export const DEFAULT_SIDEBAR_BACKDROP_SETTINGS: SidebarBackdropSettings = {
  blur: true,
  frameTransparency: FRAME_TRANSPARENCY_DEFAULT,
  sidebarPushesPage: true,
  sidebarPushStyle: DEFAULT_SIDEBAR_PUSH_STYLE,
};

/** Sent to the sidebar surface whenever the mode or the snapshot changes. */
export interface SidebarBackdropState {
  mode: SidebarBackdropMode;
  /** Only in 'snapshot' mode: page pieces under the sidebar view, positioned in sidebar-view DIPs. */
  images: SidebarBackdropImage[];
  /** True only while a separate native background View is shown behind a floating sidebar. */
  nativeOverlay: boolean;
}

export interface SidebarBackdropImage {
  dataUrl: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Blur radius under the glass hover card at rest (macOS glass): the page reads as frosted glass. */
export const SIDEBAR_HOVER_GLASS_BLUR = 30;

/**
 * Native hover layer paint. The backing View is only shown while the sidebar overlay is visible;
 * keep its material ready on the first frame and let its native bounds/radius carry the motion.
 * Ramping alpha with the slide leaves the remote page legible through the expanding card, which a
 * renderer-side CSS mask cannot clip because the page is a separate native WebContentsView.
 */
export function sidebarNativeLayerPaint(
  _progress: number,
  { glass = false }: { glass?: boolean } = {},
): {
  alpha: number;
  blur: number;
} {
  // The View is clipped/rounded and moved in lockstep with the card. It must already cover or blur
  // the page beneath the very first visible frame, before labels and pin marks finish morphing.
  return { alpha: 1, blur: glass ? SIDEBAR_HOVER_GLASS_BLUR : 0 };
}
/** Fraction of the captured bitmap's physical width kept before the one-off canvas blur. */
export const SIDEBAR_SNAPSHOT_SCALE = 0.25;
/** At most one snapshot per this many ms while the sidebar stays open. */
export const SIDEBAR_SNAPSHOT_THROTTLE_MS = 900;

export function normalizeSidebarBackdropSettings(
  input: unknown,
): SidebarBackdropSettings {
  if (typeof input !== "object" || input === null)
    return { ...DEFAULT_SIDEBAR_BACKDROP_SETTINGS };
  const candidate = input as Record<string, unknown>;
  return {
    blur:
      typeof candidate.blur === "boolean"
        ? candidate.blur
        : DEFAULT_SIDEBAR_BACKDROP_SETTINGS.blur,
    frameTransparency: normalizeFrameTransparency(candidate.frameTransparency),
    sidebarPushesPage:
      typeof candidate.sidebarPushesPage === "boolean"
        ? candidate.sidebarPushesPage
        : DEFAULT_SIDEBAR_BACKDROP_SETTINGS.sidebarPushesPage,
    sidebarPushStyle: normalizeSidebarPushStyle(candidate.sidebarPushStyle),
  };
}

export function parseSidebarBackdropOverride(
  value: string | undefined,
): SidebarBackdropMode | null {
  const normalized = value?.trim().toLowerCase();
  return normalized &&
    (SIDEBAR_BACKDROP_MODES as readonly string[]).includes(normalized)
    ? (normalized as SidebarBackdropMode)
    : null;
}

/**
 * Which path the overlay sidebar uses. Blur off is always solid. macOS defaults to a captured,
 * renderer-painted snapshot because native WebContentsView page surfaces are separate from the Views
 * compositor layer used by View.setBackgroundBlur. Other platforms stay on the solid tint.
 * `override` (SURFFISH_SIDEBAR_BACKDROP) picks a path explicitly for testing: blur off still wins.
 */
export function resolveSidebarBackdropMode({
  platform,
  settings,
  override,
}: {
  platform: NodeJS.Platform | string;
  settings: Pick<SidebarBackdropSettings, "blur">;
  override?: SidebarBackdropMode | null;
}): SidebarBackdropMode {
  if (!settings.blur) return "solid";
  if (override) return override;
  return platform === "darwin" ? "snapshot" : "solid";
}

/** The docked sidebar is part of the window frame; only a floating overlay needs its own blur layer. */
export function shouldUseNativeSidebarLayer({
  mode,
  docked,
  visible,
}: {
  mode: SidebarBackdropMode;
  docked: boolean;
  visible: boolean;
}): boolean {
  return mode === "native" && visible && !docked;
}

export function intersectRects(a: Rect, b: Rect): Rect | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  if (right <= x || bottom <= y) return null;
  return { x, y, width: right - x, height: bottom - y };
}

/**
 * The strips of each page view that sit under the sidebar. `capture` is in page-view DIPs (for
 * webContents.capturePage), `target` in sidebar-view DIPs (where the renderer draws it). Views are
 * given bottom-most first; later ones cover earlier ones.
 */
export function sidebarCaptureRegions(
  sidebar: Rect,
  pages: readonly Rect[],
): { index: number; capture: Rect; target: Rect }[] {
  const regions: { index: number; capture: Rect; target: Rect }[] = [];
  pages.forEach((page, index) => {
    const overlap = intersectRects(sidebar, page);
    if (!overlap) return;
    const round = (rect: Rect): Rect => ({
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    });
    regions.push({
      index,
      capture: round({
        x: overlap.x - page.x,
        y: overlap.y - page.y,
        width: overlap.width,
        height: overlap.height,
      }),
      target: round({
        x: overlap.x - sidebar.x,
        y: overlap.y - sidebar.y,
        width: overlap.width,
        height: overlap.height,
      }),
    });
  });
  return regions;
}

/** Throttle gate: true when a capture may run now. */
export function snapshotDue(
  lastCaptureAt: number,
  now: number,
  throttleMs = SIDEBAR_SNAPSHOT_THROTTLE_MS,
): boolean {
  return now - lastCaptureAt >= throttleMs;
}
