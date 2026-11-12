/**
 * How the hover/pinned overlay sidebar gets a legible background over a live page.
 *
 * The overlay sidebar is its own transparent WebContentsView stacked above the page's
 * WebContentsView, so CSS backdrop-filter inside it only ever sees its own (empty) layer, and
 * window vibrancy (NSVisualEffectView) sits *behind* the page view, so it can't reach either.
 * The three paths that do work:
 *  - 'native':   View.setBackgroundBlur (Electron 44): the compositor blurs whatever is under the
 *                floating hover card, live, with no renderer raster work. On macOS glass the card
 *                rests as glass: SIDEBAR_HOVER_GLASS_BLUR under the hover tint
 *                (SIDEBAR_HOVER_GLASS_ARGB, private variant in private windows). Without glass
 *                (Reduce Transparency, fullscreen) it rests as the frame's opaque surface colour
 *                and the blur only softens the fade in/out.
 *  - 'snapshot': capture the page strip under the sidebar once when it opens (and again on tab
 *                switch / navigation, throttled), shrink it, blur it once in a canvas, darken it.
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
}

export const DEFAULT_SIDEBAR_BACKDROP_SETTINGS: SidebarBackdropSettings = {
  blur: true,
  frameTransparency: FRAME_TRANSPARENCY_DEFAULT,
};

/** Sent to the sidebar surface whenever the mode or the snapshot changes. */
export interface SidebarBackdropState {
  mode: SidebarBackdropMode;
  /** Only in 'snapshot' mode: page pieces under the sidebar view, positioned in sidebar-view DIPs. */
  images: SidebarBackdropImage[];
  /** True only while a separate native View blurs live page pixels behind a floating sidebar. */
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

/** Blur radius under the opaque hover card while it fades in/out (at full strength it is opaque). */
export const SIDEBAR_NATIVE_BLUR_RADIUS = 20;
/** Blur radius under the glass hover card at rest (macOS glass): the page reads as frosted glass. */
export const SIDEBAR_HOVER_GLASS_BLUR = 30;

/**
 * Native hover layer paint at a point of the open/close slide (progress 0..1): `alpha` scales the
 * card's ground colour, `blur` is the in-window blur radius under it.
 */
export function sidebarNativeLayerPaint(
  progress: number,
  { glass = false }: { glass?: boolean } = {},
): {
  alpha: number;
  blur: number;
} {
  const alpha = Math.max(0.02, Math.min(1, progress));
  // Glass keeps its blur at rest: that is the material. Opaque, the blur only softens the page
  // while the layer is still partly see-through; once opaque it is invisible work for the
  // compositor, so drop it.
  if (glass)
    return { alpha, blur: Math.round(SIDEBAR_HOVER_GLASS_BLUR * alpha) };
  return {
    alpha,
    blur: alpha >= 1 ? 0 : Math.round(SIDEBAR_NATIVE_BLUR_RADIUS * alpha),
  };
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
 * Which path the overlay sidebar uses. Blur off is always solid. macOS defaults to the native
 * compositor blur; other platforms stay on the solid tint. `override` (SURFFISH_SIDEBAR_BACKDROP)
 * picks a path explicitly for testing: blur off still wins.
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
  return platform === "darwin" ? "native" : "solid";
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
