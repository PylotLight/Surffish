/**
 * Glance (link peek): Shift+click a link, or "Open Link in Glance" in the page's context menu, and
 * the page opens in a floating sheet over the current tab instead of a new tab. Esc or a click on
 * the dimmed backdrop closes it; Cmd/Ctrl+Enter promotes it to a real tab (same webContents, no
 * reload, history kept). One glance per window. Pure rules only; main/glance*.ts does the views.
 */

/** Settings → General → "Shift-click opens links in Glance" (on by default). */
export const GLANCE_SETTINGS_FILE = 'browser-glance.json'

export interface GlanceSettings {
  /** Shift+click on a link opens it in Glance. Off: Shift+click keeps the old behaviour. */
  shiftClick: boolean
}

/** Missing or unreadable settings keep Shift+click → Glance on (the default). */
export function parseGlanceSettings(value: unknown): GlanceSettings {
  if (typeof value === 'boolean') return { shiftClick: value }
  if (typeof value === 'object' && value !== null && (value as Record<string, unknown>).shiftClick === false) return { shiftClick: false }
  return { shiftClick: true }
}

/** Window features a Shift+clicked link never has; any of these means a script asked for a real popup. */
const POPUP_FEATURE = /(?:^|,)\s*(?:popup|width|height|left|top|innerwidth|innerheight|screenx|screeny|outerwidth|outerheight)\s*(?:=|,|$)/i

/**
 * Is this window-open request a Shift+click on a link (or Shift+Enter on a focused link)?
 * Chromium reports those as disposition `new-window` with no window features. A script's
 * `window.open(url)` without features is `foreground-tab`; a sized popup is `new-window` *with*
 * features (width=…, popup), which stays a popup.
 */
export function isShiftClickLinkOpen(details: { disposition: string; features?: string; postBody?: unknown }): boolean {
  if (details.disposition !== 'new-window') return false
  if (details.postBody) return false
  const features = (details.features ?? '').trim()
  return !POPUP_FEATURE.test(features)
}

export function isGlanceableUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

/** The palette's "Open Copied Link in Glance": the clipboard text when it is one http(s) URL. */
export function glanceUrlFromText(text: string | null | undefined): string | null {
  const trimmed = (text ?? '').trim()
  if (!trimmed || /\s/.test(trimmed) || trimmed.length > 4096) return null
  return isGlanceableUrl(trimmed) ? new URL(trimmed).toString() : null
}

export interface GlanceRect { x: number; y: number; width: number; height: number }

export interface GlanceLayout {
  /** The whole window: the dimmed backdrop (the chrome view, transparent outside the card). */
  backdrop: GlanceRect
  /** The rounded card, header included. */
  card: GlanceRect
  /** Where the page view sits inside the card, under the header. */
  page: GlanceRect
}

/** Card size as a share of the window. */
export const GLANCE_CARD_RATIO = 0.85
export const GLANCE_HEADER_HEIGHT = 40
export const GLANCE_CORNER_RADIUS = 12
/** Below this the card fills the window minus a small margin, so tiny windows still get a usable page. */
const MIN_MARGIN = 12

/** The card, ~85% of the window and centred; the page fills it below the header. */
export function glanceLayout(width: number, height: number): GlanceLayout {
  const w = Math.max(0, Math.floor(width))
  const h = Math.max(0, Math.floor(height))
  const cardWidth = Math.max(0, Math.min(w - MIN_MARGIN * 2, Math.round(w * GLANCE_CARD_RATIO)))
  const cardHeight = Math.max(0, Math.min(h - MIN_MARGIN * 2, Math.round(h * GLANCE_CARD_RATIO)))
  const card = { x: Math.round((w - cardWidth) / 2), y: Math.round((h - cardHeight) / 2), width: cardWidth, height: cardHeight }
  const header = Math.min(GLANCE_HEADER_HEIGHT, cardHeight)
  return {
    backdrop: { x: 0, y: 0, width: w, height: h },
    card,
    page: { x: card.x, y: card.y + header, width: cardWidth, height: Math.max(0, cardHeight - header) }
  }
}

/** What a key press inside the glance (page or header) does. */
export type GlanceKeyAction =
  | 'close' | 'promote' | 'reload' | 'back' | 'forward' | 'zoom-in' | 'zoom-out' | 'zoom-reset'
  /** A browser shortcut that works on tabs or opens app UI (new tab, palette, address bar…): close, then run it. */
  | 'close-and-forward'

export interface GlanceKeyInput {
  type: string
  key: string
  code?: string
  shift: boolean
  alt: boolean
  control: boolean
  meta: boolean
  isAutoRepeat?: boolean
}

/** Text editing keys the page keeps (copy, paste, select all, undo…). */
const EDITING_KEYS = new Set(['a', 'c', 'v', 'x', 'z', 'y'])

/**
 * Esc and Cmd/Ctrl+W close, Cmd/Ctrl+Enter promotes, reload / back / forward / zoom act on the
 * glance page. Any other browser shortcut closes the glance first and then runs, so Cmd+T or Cmd+K
 * never open something underneath it. Editing keys and plain typing stay with the page.
 * `mac`: the primary modifier is Cmd (else Ctrl). `fullscreen`: the page is in HTML fullscreen,
 * where Esc belongs to the page (it leaves fullscreen).
 */
export function glanceKeyAction(input: GlanceKeyInput, mac: boolean, fullscreen = false): GlanceKeyAction | null {
  if (input.type !== 'keyDown') return null
  const primary = mac ? input.meta : input.control
  const key = input.key.toLowerCase()
  if (key === 'escape' && !primary && !input.alt && !input.shift) return fullscreen ? null : 'close'
  if (!primary) {
    // Alt+Left / Alt+Right: back / forward like a tab (Windows/Linux; macOS has Cmd+[ ]).
    if (!mac && input.alt && !input.control && !input.meta && key === 'arrowleft') return 'back'
    if (!mac && input.alt && !input.control && !input.meta && key === 'arrowright') return 'forward'
    return null
  }
  if (input.isAutoRepeat && key !== '=' && key !== '-') return null
  if (key === 'enter' && !input.alt) return 'promote'
  if (input.alt) return input.shift ? null : 'close-and-forward'
  if (key === 'w' && !input.shift) return 'close'
  if (key === 'r') return 'reload'
  if (key === '[' && !input.shift) return 'back'
  if (key === ']' && !input.shift) return 'forward'
  if ((key === '=' || key === '+') && !input.shift) return 'zoom-in'
  if (key === '-' && !input.shift) return 'zoom-out'
  if (key === '0' && !input.shift) return 'zoom-reset'
  if (EDITING_KEYS.has(key) && !(mac && key === 'y')) return null
  // Bare modifier presses and function keys aren't shortcuts.
  if (key === 'meta' || key === 'control' || key === 'shift' || key === 'alt') return null
  return 'close-and-forward'
}

/** A link inside the glance asked for a new window/tab. */
export type GlanceOpenAction = 'navigate' | 'background-tab' | 'deny'

/**
 * Links clicked inside the glance navigate within the glance, target=_blank and Shift+click
 * included. Cmd/Ctrl+click (background-tab) still opens a background tab, like everywhere else.
 * Sized script popups are denied (the glance is a peek, not a popup host).
 */
export function glanceWindowOpenAction(details: { disposition: string; features?: string; url: string }): GlanceOpenAction {
  if (!isGlanceableUrl(details.url)) return 'deny'
  if (details.disposition === 'background-tab') return 'background-tab'
  if (details.disposition === 'foreground-tab' || isShiftClickLinkOpen(details)) return 'navigate'
  return 'deny'
}

/** The header's title line: the page title, else its host, else the URL. */
export function glanceTitle(title: string, url: string): string {
  const trimmed = title.trim()
  if (trimmed && trimmed !== url) return trimmed
  try {
    return new URL(url).host || url
  } catch {
    return url
  }
}

/** Header info the chrome view draws. */
export interface GlanceHeaderState {
  url: string
  title: string
  loading: boolean
  canGoBack: boolean
  private: boolean
  /** "Open in Split View" is offered (the source tab can take a split pane). */
  canSplit: boolean
}
