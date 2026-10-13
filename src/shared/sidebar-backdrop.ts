/**
 * How the hover/pinned overlay sidebar gets a legible background over a live page.
 *
 * The overlay sidebar is its own transparent WebContentsView stacked above the page's
 * WebContentsView, so CSS backdrop-filter inside it only ever sees its own (empty) layer, and
 * window vibrancy (NSVisualEffectView) sits *behind* the page view, so it can't reach either.
 * The three paths that do work:
 *  - 'native':   View.setBackgroundBlur (Electron 44): the compositor blurs whatever is under the
 *                sidebar view, live, with no renderer raster work. Paired with a translucent tint
 *                that is still readable on its own in case a platform's compositor can't sample
 *                the page beneath.
 *  - 'snapshot': capture the page strip under the sidebar once when it opens (and again on tab
 *                switch / navigation, throttled), shrink it, blur it once in a canvas, darken it.
 *  - 'solid':    a near-opaque tint. Always used when "Sidebar blur" is off.
 */
export type SidebarBackdropMode = 'native' | 'snapshot' | 'solid'

export const SIDEBAR_BACKDROP_MODES: readonly SidebarBackdropMode[] = ['native', 'snapshot', 'solid']

export interface SidebarBackdropSettings {
  /** Settings → General → Appearance → Sidebar blur. On by default. */
  blur: boolean
}

export const DEFAULT_SIDEBAR_BACKDROP_SETTINGS: SidebarBackdropSettings = { blur: true }

/** Sent to the sidebar surface whenever the mode or the snapshot changes. */
export interface SidebarBackdropState {
  mode: SidebarBackdropMode
  /** Only in 'snapshot' mode: page pieces under the sidebar view, in sidebar-view coordinates. */
  images: SidebarBackdropImage[]
  /** The sidebar view is inset + rounded to the card (it has used the native blur in this window). */
  framed: boolean
}

export interface SidebarBackdropImage {
  dataUrl: string
  x: number
  y: number
  width: number
  height: number
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** Blur radius for the native compositor blur (px). */
export const SIDEBAR_NATIVE_BLUR_RADIUS = 36
/** ARGB tint under the native blur: dark enough to read white text even if no blur shows. */
export const SIDEBAR_NATIVE_TINT = '#C4131619'
/** ARGB fill for a card-framed view after leaving the native path (blur off at runtime). */
export const SIDEBAR_FRAMED_SOLID_TINT = '#F2131619'
/** The sidebar card sits this far in from the top/bottom of the window (matches the CSS). */
export const SIDEBAR_CARD_INSET = 10
export const SIDEBAR_CARD_RADIUS = 28
/** Snapshots are downscaled this much before the one-off canvas blur (cheap to send and draw). */
export const SIDEBAR_SNAPSHOT_SCALE = 0.25
/** At most one snapshot per this many ms while the sidebar stays open. */
export const SIDEBAR_SNAPSHOT_THROTTLE_MS = 900

export function normalizeSidebarBackdropSettings(input: unknown): SidebarBackdropSettings {
  if (typeof input !== 'object' || input === null) return { ...DEFAULT_SIDEBAR_BACKDROP_SETTINGS }
  const candidate = input as Record<string, unknown>
  return { blur: typeof candidate.blur === 'boolean' ? candidate.blur : DEFAULT_SIDEBAR_BACKDROP_SETTINGS.blur }
}

export function parseSidebarBackdropOverride(value: string | undefined): SidebarBackdropMode | null {
  const normalized = value?.trim().toLowerCase()
  return normalized && (SIDEBAR_BACKDROP_MODES as readonly string[]).includes(normalized) ? normalized as SidebarBackdropMode : null
}

/**
 * Which path the overlay sidebar uses. Blur off is always solid. macOS defaults to the native
 * compositor blur; other platforms stay on the solid tint. `override` (SURFFISH_SIDEBAR_BACKDROP)
 * picks a path explicitly for testing: blur off still wins.
 */
export function resolveSidebarBackdropMode({ platform, settings, override }: {
  platform: NodeJS.Platform | string
  settings: SidebarBackdropSettings
  override?: SidebarBackdropMode | null
}): SidebarBackdropMode {
  if (!settings.blur) return 'solid'
  if (override) return override
  return platform === 'darwin' ? 'native' : 'solid'
}

export function intersectRects(a: Rect, b: Rect): Rect | null {
  const x = Math.max(a.x, b.x)
  const y = Math.max(a.y, b.y)
  const right = Math.min(a.x + a.width, b.x + b.width)
  const bottom = Math.min(a.y + a.height, b.y + b.height)
  if (right <= x || bottom <= y) return null
  return { x, y, width: right - x, height: bottom - y }
}

/**
 * The strips of each page view that sit under the sidebar. `capture` is in the page view's own
 * coordinates (for webContents.capturePage), `target` in sidebar-view coordinates (where the
 * renderer draws it). Views are given bottom-most first; later ones cover earlier ones.
 */
export function sidebarCaptureRegions(sidebar: Rect, pages: readonly Rect[]): { index: number; capture: Rect; target: Rect }[] {
  const regions: { index: number; capture: Rect; target: Rect }[] = []
  pages.forEach((page, index) => {
    const overlap = intersectRects(sidebar, page)
    if (!overlap) return
    const round = (rect: Rect): Rect => ({ x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) })
    regions.push({
      index,
      capture: round({ x: overlap.x - page.x, y: overlap.y - page.y, width: overlap.width, height: overlap.height }),
      target: round({ x: overlap.x - sidebar.x, y: overlap.y - sidebar.y, width: overlap.width, height: overlap.height })
    })
  })
  return regions
}

/** Throttle gate: true when a capture may run now. */
export function snapshotDue(lastCaptureAt: number, now: number, throttleMs = SIDEBAR_SNAPSHOT_THROTTLE_MS): boolean {
  return now - lastCaptureAt >= throttleMs
}
