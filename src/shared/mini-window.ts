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
  /** Dropped against a screen edge (or tucked with its button), the window slides away behind a handle tab (shared/mini-window-dock.ts). */
  tuckToEdge: boolean
  /** While tucked, resting the pointer on the handle peeks the window out until the pointer leaves it (shared/mini-window-peek.ts). */
  peekOnHover: boolean
  /** How long the pointer rests (still) on the handle before it peeks, one of MINI_WINDOW_PEEK_DELAYS. */
  peekDelayMs: number
  /** Let go of a drag while still moving and the window glides on, slowing to a stop (shared/mini-window-throw.ts). */
  throwMomentum: boolean
  /** How several mini windows group (MiniWindowGrouping). */
  grouping: MiniWindowGrouping
  /** Where the auto-hiding header (and tab strip) shows (MiniWindowHeaderPlacement). */
  headerPlacement: MiniWindowHeaderPlacement
  /** When the menu bar (tray) icon shows (MiniWindowMenuBarIcon; shared/mini-window-menubar.ts). */
  menuBarIcon: MiniWindowMenuBarIcon
}

/**
 * When the menu bar icon (a Tray status item; the system tray on Windows/Linux) shows:
 * - 'in-use': only while a mini window lives in the menu bar (no Tray exists otherwise).
 * - 'always': always (clicking it with nothing there offers to send the current tab).
 * - 'never': never; sending a mini window to the menu bar is unavailable.
 */
export type MiniWindowMenuBarIcon = 'in-use' | 'always' | 'never'
export const MINI_WINDOW_MENU_BAR_ICONS: readonly MiniWindowMenuBarIcon[] = ['in-use', 'always', 'never']

export function isMiniWindowMenuBarIcon(value: unknown): value is MiniWindowMenuBarIcon {
  return typeof value === 'string' && (MINI_WINDOW_MENU_BAR_ICONS as readonly string[]).includes(value)
}

/**
 * Where the mini window's auto-hiding header (and its tab strip) shows when revealed:
 * - 'float': in a separate always-on-top panel attached outside the window, above its top edge
 *   (below its bottom edge when there is no room above), so it never covers the page.
 * - 'push': inside the window, and the page moves down (and shrinks) while it shows.
 * - 'overlay': inside the window, over the top of the page (the original behaviour).
 */
export type MiniWindowHeaderPlacement = 'float' | 'push' | 'overlay'
export const MINI_WINDOW_HEADER_PLACEMENTS: readonly MiniWindowHeaderPlacement[] = ['float', 'push', 'overlay']

export function isMiniWindowHeaderPlacement(value: unknown): value is MiniWindowHeaderPlacement {
  return typeof value === 'string' && (MINI_WINDOW_HEADER_PLACEMENTS as readonly string[]).includes(value)
}

/**
 * How several mini windows group:
 * - 'tabs': a collection is one mini window with a compact tab strip; popping a tab out adds it to the
 *   last used collection, dragging a tab out of the strip splits it off, dropping a window's header on
 *   another (or docking it to an edge that already holds one) merges them. One handle per collection.
 * - 'stack': separate windows, but those docked to the same edge of a display share one handle and
 *   slide out together, stacked along the edge.
 * - 'separate': every mini window on its own, each with its own handle.
 */
export type MiniWindowGrouping = 'tabs' | 'stack' | 'separate'
export const MINI_WINDOW_GROUPINGS: readonly MiniWindowGrouping[] = ['tabs', 'stack', 'separate']

export const DEFAULT_MINI_WINDOW_SETTINGS: MiniWindowSettings = { defaultUrl: '', shortcut: DEFAULT_MINI_WINDOW_SHORTCUT, opacity: 1, tuckToEdge: true, peekOnHover: true, peekDelayMs: 350, throwMomentum: true, grouping: 'tabs', headerPlacement: 'float', menuBarIcon: 'in-use' }

/** Settings → Mini window → hover delay choices (ms). */
export const MINI_WINDOW_PEEK_DELAYS: readonly number[] = [200, 350, 600, 1000]

export function isMiniWindowPeekDelay(value: unknown): value is number {
  return typeof value === 'number' && MINI_WINDOW_PEEK_DELAYS.includes(value)
}

export function isMiniWindowGrouping(value: unknown): value is MiniWindowGrouping {
  return typeof value === 'string' && (MINI_WINDOW_GROUPINGS as readonly string[]).includes(value)
}

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
  const tuckToEdge = typeof record.tuckToEdge === 'boolean' ? record.tuckToEdge : DEFAULT_MINI_WINDOW_SETTINGS.tuckToEdge
  // Peek used to be off by default and every save wrote it, so a stored value only counts once the
  // hover delay exists next to it (saved by a build with hover peek on by default); older files take the new default.
  const peekOnHover = typeof record.peekOnHover === 'boolean' && 'peekDelayMs' in record ? record.peekOnHover : DEFAULT_MINI_WINDOW_SETTINGS.peekOnHover
  const peekDelayMs = isMiniWindowPeekDelay(record.peekDelayMs) ? record.peekDelayMs : DEFAULT_MINI_WINDOW_SETTINGS.peekDelayMs
  // Settings saved before throwing existed take the default (on).
  const throwMomentum = typeof record.throwMomentum === 'boolean' ? record.throwMomentum : DEFAULT_MINI_WINDOW_SETTINGS.throwMomentum
  // Settings saved before grouping existed (one window per tab) take the default.
  const grouping = isMiniWindowGrouping(record.grouping) ? record.grouping : DEFAULT_MINI_WINDOW_SETTINGS.grouping
  // Settings saved before the header placement existed take the default (float above the window).
  const headerPlacement = isMiniWindowHeaderPlacement(record.headerPlacement) ? record.headerPlacement : DEFAULT_MINI_WINDOW_SETTINGS.headerPlacement
  // Settings saved before the menu bar icon existed take the default (shown only while in use).
  const menuBarIcon = isMiniWindowMenuBarIcon(record.menuBarIcon) ? record.menuBarIcon : DEFAULT_MINI_WINDOW_SETTINGS.menuBarIcon
  return { defaultUrl, shortcut, opacity, tuckToEdge, peekOnHover, peekDelayMs, throwMomentum, grouping, headerPlacement, menuBarIcon }
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
/** The tab strip under the header row (grouping 'tabs', two or more tabs in the window). */
export const MINI_WINDOW_TAB_STRIP_HEIGHT = 28
/**
 * The menu bar popout's header: one slim strip that is always there (tabs or the page's title, then
 * ⋯ / Pin / Close), never auto-hiding, never moving the page. It adds to the window (the page keeps
 * the popout's size below it).
 */
export const MINI_WINDOW_POPOUT_STRIP_HEIGHT = 28

/**
 * The menu bar popout's address field row: with tabs in the strip, the field gets a row of its own
 * under it (the chips and + stay put) instead of taking the strip's place. It hangs over the page
 * like the field's dropdown (the page never moves for it). Header page CSS: #addr in body.popout.tabbed.
 */
export const MINI_WINDOW_POPOUT_ADDRESS_HEIGHT = 32

/** The popout's address row while its field shows: only with tabs in the strip (one tab: the field takes the title's place). */
export function miniPopoutAddressRow(inMenuBar: boolean, addressOpen: boolean, tabCount: number, grouping: MiniWindowGrouping): number {
  return inMenuBar && addressOpen && grouping === 'tabs' && tabCount > 1 ? MINI_WINDOW_POPOUT_ADDRESS_HEIGHT : 0
}

/** Height of the revealed header: the header row, plus the tab strip when the window holds several tabs. */
export function miniHeaderHeight(tabCount: number, grouping: MiniWindowGrouping): number {
  return MINI_WINDOW_HEADER_HEIGHT + (grouping === 'tabs' && tabCount > 1 ? MINI_WINDOW_TAB_STRIP_HEIGHT : 0)
}

/**
 * How the revealed header sits: in a panel above or below the window, pushing the page down, or over
 * it; 'strip' (the menu bar popout): always shown above the page, never revealed or hidden.
 */
export type MiniHeaderLayout = { kind: 'above' | 'below'; panel: MiniRect } | { kind: 'push' } | { kind: 'overlay' } | { kind: 'strip' }

/** The header panel's bounds on `side` of a window at `window` (same x and width, `height` tall, touching its edge). */
export function miniHeaderPanelRect(window: MiniRect, height: number, side: 'above' | 'below'): MiniRect {
  return { x: window.x, y: side === 'above' ? window.y - height : window.y + window.height, width: window.width, height }
}

/**
 * Where the revealed header goes for `placement`. 'float': above the window when the panel fits inside
 * the work area there (and the window is not docked to the top edge), else below (unless docked to the
 * bottom edge), else it pushes the page instead. `lockedSide`: keep this side regardless of room (while
 * the window is being dragged by its header, so it never flips under the pointer).
 */
export function planMiniHeader(placement: MiniWindowHeaderPlacement, window: MiniRect, height: number, workArea: MiniRect, dockEdge: string | null, lockedSide: 'above' | 'below' | null = null): MiniHeaderLayout {
  if (placement === 'overlay') return { kind: 'overlay' }
  if (placement === 'push') return { kind: 'push' }
  if (lockedSide) return { kind: lockedSide, panel: miniHeaderPanelRect(window, height, lockedSide) }
  if (dockEdge !== 'top' && window.y - height >= workArea.y) return { kind: 'above', panel: miniHeaderPanelRect(window, height, 'above') }
  if (dockEdge !== 'bottom' && window.y + window.height + height <= workArea.y + workArea.height) return { kind: 'below', panel: miniHeaderPanelRect(window, height, 'below') }
  return { kind: 'push' }
}

/** Is a pointer `y` px from the top of a window `height` tall in the zone that reveals the header (its bottom edge when the header floats below)? */
export function inMiniRevealZone(kind: MiniHeaderLayout['kind'], y: number, height: number, zone = MINI_WINDOW_REVEAL_ZONE): boolean {
  // The popout's strip is always there: nothing to reveal.
  if (kind === 'strip' || y < 0 || y >= height) return false
  return kind === 'below' ? y >= height - zone : y <= zone
}

/** The page's bounds inside a window of `size`: everything, except 'push' moves it under the revealed header and 'strip' always sits under its strip. */
export function miniPageBounds(kind: MiniHeaderLayout['kind'], revealed: boolean, size: { width: number; height: number }, headerHeight: number): MiniRect {
  if (kind !== 'strip' && (kind !== 'push' || !revealed)) return { x: 0, y: 0, width: size.width, height: size.height }
  const top = Math.min(headerHeight, Math.max(0, size.height - 1))
  return { x: 0, y: top, width: size.width, height: size.height - top }
}

/** The smallest rect holding both. */
export function unionMiniRect(a: MiniRect, b: MiniRect): MiniRect {
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  return { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y }
}

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

// ---------------------------------------------------------------------------
// Several mini windows

/** How many mini windows can be open at once. */
export const MINI_WINDOW_MAX = 6
/** A new mini window opens this far (x and y) from one already there, so they never stack exactly. */
export const MINI_WINDOW_CASCADE_STEP = 28

/** The lowest slot no open mini window uses (slots key each window's remembered spot), or null when all MINI_WINDOW_MAX are taken. */
export function freeMiniSlot(used: readonly number[], max = MINI_WINDOW_MAX): number | null {
  for (let slot = 0; slot < max; slot++) if (!used.includes(slot)) return slot
  return null
}

/**
 * `rect` (fitted to the work area), stepped diagonally by MINI_WINDOW_CASCADE_STEP until no window in
 * `others` sits at (about) the same spot. It steps toward the middle of the work area, so a window
 * in the bottom-right corner cascades up and left. Stops where it can't move further.
 */
export function cascadeMiniBounds(rect: MiniRect, others: readonly MiniRect[], workArea: MiniRect, step = MINI_WINDOW_CASCADE_STEP): MiniRect {
  let current = clampMiniBounds(rect, workArea)
  const dx = current.x + current.width / 2 > workArea.x + workArea.width / 2 ? -step : step
  const dy = current.y + current.height / 2 > workArea.y + workArea.height / 2 ? -step : step
  const taken = (r: MiniRect): boolean => others.some((other) => Math.abs(other.x - r.x) < step / 2 && Math.abs(other.y - r.y) < step / 2)
  for (let i = 0; i < 64 && taken(current); i++) {
    const next = clampMiniBounds({ ...current, x: current.x + dx, y: current.y + dy }, workArea)
    if (next.x === current.x && next.y === current.y) break
    current = next
  }
  return current
}

/**
 * Per-window remembered state, one record per slot (`{ slots: [...] }`). The single-window format
 * (just the per-display record) reads as slot 0, so an existing spot or dock carries over.
 */
export function parseMiniSlots<T>(value: unknown, parseOne: (value: unknown) => Record<string, T>): Array<Record<string, T>> {
  if (typeof value !== 'object' || value === null) return []
  const slots = (value as Record<string, unknown>).slots
  if (Array.isArray(slots)) return slots.slice(0, MINI_WINDOW_MAX).map((slot) => parseOne(slot))
  const legacy = parseOne(value)
  return Object.keys(legacy).length > 0 ? [legacy] : []
}

/** One slot's record set to `record` (others kept), ready to write back as `{ slots }`. */
export function withMiniSlot<T>(slots: ReadonlyArray<Record<string, T>>, slot: number, record: Record<string, T>): { slots: Array<Record<string, T>> } {
  const next = slots.map((entry) => ({ ...entry }))
  while (next.length <= slot) next.push({})
  next[slot] = record
  // Trailing empty slots carry nothing.
  while (next.length > 0 && Object.keys(next[next.length - 1] ?? {}).length === 0) next.pop()
  return { slots: next }
}

// ---------------------------------------------------------------------------
// Grouping

function inside(point: { x: number; y: number }, rect: MiniRect): boolean {
  return point.x >= rect.x && point.x < rect.x + rect.width && point.y >= rect.y && point.y < rect.y + rect.height
}

/**
 * Grouping 'tabs': the window a window dropped with its header at `point` merges into, i.e. the
 * first of `others` whose header band (its top MINI_WINDOW_REVEAL_ZONE px, plus `above` px over its
 * top edge where a floating header sits) is under the point; null when none. Only the header band
 * counts, so overlapping two windows never merges them by accident.
 */
export function miniMergeTarget<T extends { bounds: MiniRect }>(point: { x: number; y: number }, others: readonly T[], above = 0): T | null {
  return others.find((other) => inside(point, { ...other.bounds, y: other.bounds.y - above, height: Math.min(other.bounds.height, MINI_WINDOW_REVEAL_ZONE) + above })) ?? null
}

/** Where a window split off at `point` goes: its own size, header centred under the pointer, fitted to the work area. */
export function miniSplitBounds(point: { x: number; y: number }, size: { width: number; height: number }, workArea: MiniRect): MiniRect {
  return clampMiniBounds({ x: Math.round(point.x - size.width / 2), y: Math.round(point.y - MINI_WINDOW_HEADER_HEIGHT / 2), width: size.width, height: size.height }, workArea)
}

export interface MiniRegroupWindow {
  id: number
  tabs: number
  /** Docked: which display edge (`displayId:edge`), else null. */
  dockKey: string | null
}

/**
 * Switching grouping with mini windows open (no page reloads, only views move):
 * - to 'tabs': windows docked to the same display edge merge into the oldest of them (one handle per
 *   edge, the pile #203 left); undocked windows stay their own collections.
 * - to 'stack' / 'separate': every window holding several tabs splits, one tab per window.
 * `windows` oldest first; `merge.from` keeps that order.
 */
export function planMiniRegroup(grouping: MiniWindowGrouping, windows: readonly MiniRegroupWindow[]): { merge: Array<{ into: number; from: number[] }>; split: number[] } {
  if (grouping !== 'tabs') return { merge: [], split: windows.filter((w) => w.tabs > 1).map((w) => w.id) }
  const byKey = new Map<string, number[]>()
  for (const w of windows) {
    if (!w.dockKey) continue
    byKey.set(w.dockKey, [...(byKey.get(w.dockKey) ?? []), w.id])
  }
  const merge = [...byKey.values()].filter((ids) => ids.length > 1).map(([into, ...from]) => ({ into: into as number, from }))
  return { merge, split: [] }
}
