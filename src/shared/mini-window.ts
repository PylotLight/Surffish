/**
 * Mini window: a small frameless always-on-top window that holds one tab's live page (an AI chat,
 * a video, docs) while you work in other apps. "Pop Out to Mini Window" moves a tab's own view in
 * (no reload), "Return to Browser" moves it back. A global shortcut toggles it: it opens the pinned
 * default page when nothing is in the mini window, otherwise shows/hides it.
 * Pure rules only; main/mini-window*.ts does the windows and views.
 */

/** Settings → General → Mini window. */
export const MINI_WINDOW_SETTINGS_FILE = 'browser-mini-window.json'
/** Last size/position per display (separate from settings so a settings write never drops it). */
export const MINI_WINDOW_GEOMETRY_FILE = 'mini-window-geometry.json'

/** Default global toggle. ⌘⇧Space on macOS, Ctrl+Shift+Space elsewhere. Off when another app holds it. */
export const DEFAULT_MINI_WINDOW_SHORTCUT = 'CommandOrControl+Shift+Space'
export const MINI_WINDOW_MIN_OPACITY = 0.4

export interface MiniWindowSettings {
  /** Page the toggle shortcut opens when the mini window is empty ('' = pop out the current tab). */
  defaultUrl: string
  /** Global accelerator that toggles the mini window ('' = off). */
  shortcut: string
  /** Window opacity, MINI_WINDOW_MIN_OPACITY..1 (macOS and Windows; Linux ignores it). */
  opacity: number
}

export const DEFAULT_MINI_WINDOW_SETTINGS: MiniWindowSettings = { defaultUrl: '', shortcut: DEFAULT_MINI_WINDOW_SHORTCUT, opacity: 1 }

/**
 * The default page as typed in Settings: '' stays off; a bare host ("claude.ai") becomes https://.
 * Anything that isn't http(s) is rejected (null).
 */
export function normalizeMiniWindowUrl(input: unknown): string | null {
  if (typeof input !== 'string') return null
  const trimmed = input.trim()
  if (!trimmed) return ''
  if (trimmed.length > 2048 || /\s/.test(trimmed)) return null
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`
  try {
    const url = new URL(withScheme)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    if (!url.hostname || url.username || url.password) return null
    return url.toString()
  } catch {
    return null
  }
}

const MODIFIERS = new Map<string, string>([
  ['commandorcontrol', 'CommandOrControl'], ['cmdorctrl', 'CommandOrControl'],
  ['command', 'Command'], ['cmd', 'Command'], ['super', 'Super'], ['meta', 'Super'],
  ['control', 'Control'], ['ctrl', 'Control'],
  ['alt', 'Alt'], ['option', 'Alt'], ['altgr', 'AltGr'],
  ['shift', 'Shift']
])
const NAMED_KEYS = new Set([
  'Space', 'Tab', 'Backspace', 'Delete', 'Insert', 'Return', 'Enter', 'Up', 'Down', 'Left', 'Right',
  'Home', 'End', 'PageUp', 'PageDown', 'Escape', 'Esc', 'Plus'
])
const MODIFIER_ORDER = ['CommandOrControl', 'Command', 'Super', 'Control', 'Alt', 'AltGr', 'Shift']

/**
 * A global shortcut as Electron's accelerator syntax, normalized ("cmd+shift+space" →
 * "Command+Shift+Space"), or null when it isn't usable: it needs at least one modifier other than
 * Shift (a bare key or Shift+key would eat typing everywhere) and exactly one key.
 */
export function normalizeAccelerator(input: unknown): string | null {
  if (typeof input !== 'string') return null
  const parts = input.split('+').map((part) => part.trim()).filter(Boolean)
  if (parts.length < 2 || parts.length > 5) return null
  const modifiers = new Set<string>()
  let key: string | null = null
  for (const part of parts) {
    const modifier = MODIFIERS.get(part.toLowerCase())
    if (modifier) {
      modifiers.add(modifier)
      continue
    }
    if (key !== null) return null
    if (/^[a-z0-9]$/i.test(part)) key = part.toUpperCase()
    else if (/^f([1-9]|1[0-9]|2[0-4])$/i.test(part)) key = part.toUpperCase()
    else {
      const named = [...NAMED_KEYS].find((name) => name.toLowerCase() === part.toLowerCase())
      if (named) key = named === 'Esc' ? 'Escape' : named === 'Enter' ? 'Return' : named
      else if (/^[-=[\]\\;',./`]$/.test(part)) key = part
      else return null
    }
  }
  if (!key) return null
  if (![...modifiers].some((modifier) => modifier !== 'Shift')) return null
  return [...MODIFIER_ORDER.filter((modifier) => modifiers.has(modifier)), key].join('+')
}

/** Settings as stored (or sent from Settings): anything unreadable falls back to the defaults. */
export function parseMiniWindowSettings(value: unknown): MiniWindowSettings {
  const record = typeof value === 'object' && value !== null ? value as Record<string, unknown> : {}
  const defaultUrl = normalizeMiniWindowUrl(record.defaultUrl) ?? ''
  // An explicit '' turns the shortcut off; missing or invalid keeps the default.
  const shortcut = record.shortcut === '' ? '' : normalizeAccelerator(record.shortcut) ?? DEFAULT_MINI_WINDOW_SHORTCUT
  const opacity = typeof record.opacity === 'number' && Number.isFinite(record.opacity)
    ? Math.round(Math.min(1, Math.max(MINI_WINDOW_MIN_OPACITY, record.opacity)) * 100) / 100
    : 1
  return { defaultUrl, shortcut, opacity }
}

/** Accelerators compared on what they press (CommandOrControl counts as Command on macOS, Control elsewhere). */
function acceleratorKeys(accelerator: string, isMac: boolean): string | null {
  const normalized = normalizeAccelerator(accelerator.replace(/CmdOrCtrl/gi, 'CommandOrControl'))
  if (!normalized) return null
  return normalized.split('+').map((part) => part === 'CommandOrControl' ? (isMac ? 'Command' : 'Control') : part).sort().join('+')
}

/** The first of Surffish's own shortcuts `accelerator` would shadow, or null. */
export function clashingAppShortcut(accelerator: string, appShortcuts: readonly string[], isMac: boolean): string | null {
  const wanted = acceleratorKeys(accelerator, isMac)
  if (!wanted) return null
  return appShortcuts.find((shortcut) => shortcut && acceleratorKeys(shortcut, isMac) === wanted) ?? null
}

/** A key press in Settings' shortcut field as an accelerator ("Command+Shift+Space"), or null while only modifiers are down. */
export function acceleratorFromKeyEvent(event: { key: string; code: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean }, isMac: boolean): string | null {
  let key: string | null = null
  if (event.code === 'Space') key = 'Space'
  else if (/^Key[A-Z]$/.test(event.code)) key = event.code.slice(3)
  else if (/^Digit[0-9]$/.test(event.code)) key = event.code.slice(5)
  else if (/^F([1-9]|1[0-9]|2[0-4])$/.test(event.code)) key = event.code
  else {
    const named: Record<string, string> = { ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', Enter: 'Return', Escape: 'Escape', Tab: 'Tab', Backspace: 'Backspace', Delete: 'Delete', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown' }
    key = named[event.key] ?? null
  }
  if (!key) return null
  const parts: string[] = []
  if (isMac) {
    if (event.metaKey) parts.push('Command')
    if (event.ctrlKey) parts.push('Control')
  } else {
    if (event.ctrlKey) parts.push('Control')
    if (event.metaKey) parts.push('Super')
  }
  if (event.altKey) parts.push('Alt')
  if (event.shiftKey) parts.push('Shift')
  return normalizeAccelerator([...parts, key].join('+'))
}

/** How an accelerator reads in Settings and menus ("⌘⇧Space" on macOS, "Ctrl+Shift+Space" elsewhere). */
export function formatAccelerator(accelerator: string, isMac: boolean): string {
  if (!accelerator) return 'Off'
  const parts = accelerator.split('+')
  if (isMac) {
    const symbols: Record<string, string> = { CommandOrControl: '⌘', Command: '⌘', Control: '⌃', Alt: '⌥', Shift: '⇧', Super: '⌘' }
    return parts.map((part) => symbols[part] ?? part).join('')
  }
  const names: Record<string, string> = { CommandOrControl: 'Ctrl', Control: 'Ctrl', Command: 'Super', Super: 'Super' }
  return parts.map((part) => names[part] ?? part).join('+')
}

// ---------------------------------------------------------------------------
// Geometry

export interface MiniRect { x: number; y: number; width: number; height: number }

export const MINI_WINDOW_DEFAULT_SIZE = { width: 420, height: 620 }
export const MINI_WINDOW_MIN_SIZE = { width: 280, height: 200 }
/** Gap kept from the work area's edges when placed in (or snapped to) a corner. */
export const MINI_WINDOW_MARGIN = 16
/** Dropped this close to a corner (both edges), the window snaps into it. */
export const MINI_WINDOW_SNAP_DISTANCE = 32
/** Header height when revealed; the page runs under it (the header overlays the page's top). */
export const MINI_WINDOW_HEADER_HEIGHT = 36
/** Pointer this close to the top of the page reveals the header. */
export const MINI_WINDOW_REVEAL_ZONE = 44

/** Saved geometry is keyed by display (its work area), so each monitor remembers its own spot. */
export function miniDisplayKey(workArea: MiniRect): string {
  return `${Math.round(workArea.x)},${Math.round(workArea.y)},${Math.round(workArea.width)}x${Math.round(workArea.height)}`
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

export function parseMiniGeometry(value: unknown): Record<string, MiniRect> {
  const out: Record<string, MiniRect> = {}
  if (typeof value !== 'object' || value === null) return out
  for (const [key, rect] of Object.entries(value as Record<string, unknown>).slice(0, 16)) {
    if (typeof rect !== 'object' || rect === null) continue
    const { x, y, width, height } = rect as Record<string, unknown>
    if (finite(x) && finite(y) && finite(width) && finite(height) && width > 0 && height > 0) out[key] = { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) }
  }
  return out
}

/** Fit `rect` inside the work area (shrinking it to fit, never below the minimum size). */
export function clampMiniBounds(rect: MiniRect, workArea: MiniRect): MiniRect {
  const width = Math.max(MINI_WINDOW_MIN_SIZE.width, Math.min(Math.round(rect.width), workArea.width))
  const height = Math.max(MINI_WINDOW_MIN_SIZE.height, Math.min(Math.round(rect.height), workArea.height))
  const x = Math.min(Math.max(Math.round(rect.x), workArea.x), workArea.x + workArea.width - width)
  const y = Math.min(Math.max(Math.round(rect.y), workArea.y), workArea.y + workArea.height - height)
  return { x, y, width, height }
}

/** Where a new mini window goes on a display: its saved spot there, else the bottom-right corner. */
export function initialMiniBounds(workArea: MiniRect, saved: MiniRect | undefined): MiniRect {
  if (saved) return clampMiniBounds(saved, workArea)
  const { width, height } = MINI_WINDOW_DEFAULT_SIZE
  return clampMiniBounds({
    x: workArea.x + workArea.width - width - MINI_WINDOW_MARGIN,
    y: workArea.y + workArea.height - height - MINI_WINDOW_MARGIN,
    width,
    height
  }, workArea)
}

/** Dropped near a corner of the work area: the bounds snapped into it (MINI_WINDOW_MARGIN from both edges), else null. */
export function snapMiniToCorner(rect: MiniRect, workArea: MiniRect, distance = MINI_WINDOW_SNAP_DISTANCE): MiniRect | null {
  const left = rect.x - workArea.x
  const top = rect.y - workArea.y
  const right = workArea.x + workArea.width - (rect.x + rect.width)
  const bottom = workArea.y + workArea.height - (rect.y + rect.height)
  const nearLeft = left <= distance
  const nearRight = right <= distance
  const nearTop = top <= distance
  const nearBottom = bottom <= distance
  if (!((nearLeft || nearRight) && (nearTop || nearBottom))) return null
  const x = nearLeft ? workArea.x + MINI_WINDOW_MARGIN : workArea.x + workArea.width - rect.width - MINI_WINDOW_MARGIN
  const y = nearTop ? workArea.y + MINI_WINDOW_MARGIN : workArea.y + workArea.height - rect.height - MINI_WINDOW_MARGIN
  if (x === rect.x && y === rect.y) return null
  return { ...rect, x, y }
}

/** Header strip state sent to the header page. */
export interface MiniWindowHeaderState {
  title: string
  url: string
  faviconUrl: string | null
  loading: boolean
  canGoBack: boolean
  private: boolean
}

/** What the tab's address shows in the header: host + path, without the scheme. */
export function miniHeaderUrl(url: string): string {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return url
    const path = parsed.pathname === '/' ? '' : parsed.pathname
    return `${parsed.host}${path}`
  } catch {
    return url
  }
}

/** Can a tab with this page go into the mini window? Web pages only (not New Tab, PDF editor or extension pages). */
export function canPopOutUrl(url: string): boolean {
  return /^https?:\/\//i.test(url)
}
