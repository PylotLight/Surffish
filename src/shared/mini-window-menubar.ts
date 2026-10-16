/**
 * Mini window in the menu bar: a mini window (or a 'tabs' collection) can live behind one Tray
 * status item instead of floating or being tucked to a screen edge. Clicking the item drops the mini
 * out as a panel anchored under the icon (above it for a taskbar at the bottom of the screen); click
 * again, press Esc or click elsewhere (unless pinned) and it hides. Hidden is not closed: the page
 * keeps running and audio keeps playing, like a tucked mini window.
 * Pure rules only (geometry, the show/hide state, the drop-in animation on the shared frame loop,
 * what is remembered); main/mini-window-menubar.ts owns the Tray and main/mini-window.ts the windows.
 */
import { easeOut, type FrameLoop } from './mini-window-motion'
import { MINI_WINDOW_MAX, MINI_WINDOW_MIN_SIZE, canPopOutUrl, type MiniRect, type MiniWindowMenuBarIcon } from './mini-window'

/** Which mini windows live in the menu bar and the popout's size, kept across restarts (private tabs never). */
export const MINI_WINDOW_MENU_BAR_FILE = 'mini-window-menubar.json'
/** The popout's size until it is resized. */
export const MINI_MENU_BAR_DEFAULT_SIZE = { width: 400, height: 560 }
/** Gap between the icon (the menu bar) and the popout. */
export const MINI_MENU_BAR_GAP = 4
/** Kept from the work area's sides when the icon sits near a screen edge. */
export const MINI_MENU_BAR_MARGIN = 8
/** How far the popout drops (or rises) into place while it fades in. */
export const MINI_MENU_BAR_DROP_PX = 10
/** The drop-in's length. */
export const MINI_MENU_BAR_DROP_MS = 140
/**
 * A click on the icon this soon after the popout hid because it lost focus is the click that took the
 * focus away (pressing the icon blurs the popout first): it closes, never reopens.
 */
export const MINI_MENU_BAR_BLUR_CLICK_MS = 400

/** Does the Tray exist? 'in-use' only while a mini window lives in the menu bar; never one for 'never'. */
export function wantsMenuBarTray(mode: MiniWindowMenuBarIcon, inMenuBar: number): boolean {
  if (mode === 'never') return false
  return mode === 'always' || inMenuBar > 0
}

/** Text beside the icon (macOS): the count when several live there, and a note while one plays audio. */
export function menuBarTrayTitle(count: number, audio: boolean): string {
  return [count > 1 ? String(count) : '', audio ? '♪' : ''].filter(Boolean).join(' ')
}

/** The icon's tooltip: what lives there (the first few titles), and whether one is playing. */
export function menuBarTrayTooltip(titles: readonly string[], audio: boolean): string {
  if (titles.length === 0) return 'Surffish mini window'
  const shown = titles.slice(0, 3).map((title) => title.length > 60 ? `${title.slice(0, 59)}…` : title)
  const more = titles.length > 3 ? ` +${titles.length - 3} more` : ''
  return `${shown.join(', ')}${more}${audio ? ' (playing)' : ''}`
}

export interface MenuBarDisplay { bounds: MiniRect; workArea: MiniRect }

/**
 * Where the popout goes for a click on the icon at `anchor` (the Tray's bounds; null or empty, as on
 * many Linux trays: the pointer at `cursor` stands in): centred under the icon, just below the menu
 * bar (its bottom or the work area's top, whichever is lower, so a notch's taller bar counts), or just
 * above the icon when it sits in the lower half of the display (a Windows/Linux taskbar at the bottom).
 * Fitted to the work area: its size never over it (nor under the minimum), its sides kept
 * MINI_MENU_BAR_MARGIN in. `side` says which way it opened (the drop-in comes from that side).
 */
export function menuBarPopoutBounds(anchor: MiniRect | null, cursor: { x: number; y: number }, size: { width: number; height: number }, display: MenuBarDisplay): { bounds: MiniRect; side: 'below' | 'above' } {
  const icon = anchor && anchor.width > 0 && anchor.height > 0 ? anchor : { x: cursor.x, y: cursor.y, width: 0, height: 0 }
  const wa = display.workArea
  const room = { width: Math.max(1, wa.width - 2 * MINI_MENU_BAR_MARGIN), height: Math.max(1, wa.height - 2 * MINI_MENU_BAR_GAP) }
  const width = Math.round(Math.min(room.width, Math.max(MINI_WINDOW_MIN_SIZE.width, size.width)))
  const height = Math.round(Math.min(room.height, Math.max(MINI_WINDOW_MIN_SIZE.height, size.height)))
  const centreX = icon.x + icon.width / 2
  const centreY = icon.y + icon.height / 2
  const minX = wa.x + Math.min(MINI_MENU_BAR_MARGIN, Math.max(0, (wa.width - width) / 2))
  const maxX = wa.x + wa.width - width - Math.min(MINI_MENU_BAR_MARGIN, Math.max(0, (wa.width - width) / 2))
  const x = Math.round(Math.min(maxX, Math.max(minX, centreX - width / 2)))
  const lowerHalf = centreY > display.bounds.y + display.bounds.height / 2
  const side: 'below' | 'above' = lowerHalf ? 'above' : 'below'
  const wanted = side === 'below'
    ? Math.max(icon.y + icon.height, wa.y) + MINI_MENU_BAR_GAP
    : Math.min(icon.y, wa.y + wa.height) - height - MINI_MENU_BAR_GAP
  const y = Math.round(Math.min(wa.y + wa.height - height, Math.max(wa.y, wanted)))
  return { bounds: { x, y, width, height }, side }
}

/** Frame `t` (0..1) of the drop-in: `MINI_MENU_BAR_DROP_PX` short of `target` on the side it came from, fading in to `opacity`. */
export function menuBarDropFrame(target: MiniRect, side: 'below' | 'above', t: number, opacity: number): { rect: MiniRect; opacity: number } {
  const e = easeOut(t)
  const offset = Math.round(MINI_MENU_BAR_DROP_PX * (1 - e)) * (side === 'below' ? -1 : 1)
  return { rect: { ...target, y: target.y + offset }, opacity: Math.round(opacity * e * 1000) / 1000 }
}

/** Which menu bar mini a click on the icon shows: the one shown last when it is still there, else the newest. */
export function pickMenuBarMini<T>(entries: readonly T[], last: T | null): T | null {
  if (last !== null && entries.includes(last)) return last
  return entries.at(-1) ?? null
}

export interface MenuBarPopoutDeps {
  now(): number
  loop: FrameLoop
  /** Put the window at `rect` (queued in the loop's tick while animating). */
  place(rect: MiniRect): void
  /** Window opacity (null: the platform has none, so it only drops in). */
  setOpacity: ((opacity: number) => void) | null
  /** The opacity it settles at (Settings → Mini window → Opacity). */
  opacity(): number
  /** Show the window (focused: it takes the keyboard, so Esc and clicks elsewhere reach it). */
  show(focus: boolean): void
  hide(): void
  reducedMotion(): boolean
}

export interface MenuBarPopout {
  /** On screen (or dropping in). */
  shown(): boolean
  /** Drop in at `target`, coming from `side` (instant with reduced motion). */
  open(target: MiniRect, side: 'below' | 'above', focus: boolean): void
  /** Hide (instant). */
  close(): void
  /** It lost focus: hide unless `pinned`. True when it hid. */
  blur(pinned: boolean): boolean
  /** The icon was clicked: what to do ('none' for the click that just blurred it shut). */
  click(): 'show' | 'hide' | 'none'
  /** Mid drop-in. */
  animating(): boolean
  dispose(): void
}

/** One menu bar mini's popout: shown/hidden, the drop-in on the shared frame loop, and the icon click after a blur. */
export function createMenuBarPopout(deps: MenuBarPopoutDeps): MenuBarPopout {
  const key = {}
  let shown = false
  let animating = false
  let blurHiddenAt = Number.NEGATIVE_INFINITY

  function stop(): void {
    deps.loop.cancel(key)
    animating = false
  }

  function close(): void {
    stop()
    if (!shown) return
    shown = false
    deps.hide()
  }

  return {
    shown: () => shown,
    open: (target, side, focus) => {
      stop()
      const opacity = deps.opacity()
      if (deps.reducedMotion() || shown) {
        // Already up (another click while shown re-anchors it): just move there.
        deps.place(target)
        deps.setOpacity?.(opacity)
        if (!shown) deps.show(focus)
        else if (focus) deps.show(true)
        shown = true
        return
      }
      const first = menuBarDropFrame(target, side, 0, opacity)
      deps.place(first.rect)
      deps.setOpacity?.(first.opacity)
      deps.show(focus)
      shown = true
      animating = true
      const start = deps.now()
      deps.loop.run(key, (now) => {
        if (!shown) {
          animating = false
          return false
        }
        const t = Math.min(1, (now - start) / MINI_MENU_BAR_DROP_MS)
        const frame = menuBarDropFrame(target, side, t, opacity)
        deps.place(frame.rect)
        deps.setOpacity?.(frame.opacity)
        if (t >= 1) {
          animating = false
          return false
        }
        return true
      })
    },
    close,
    blur: (pinned) => {
      if (!shown || pinned) return false
      blurHiddenAt = deps.now()
      close()
      return true
    },
    click: () => {
      if (shown) return 'hide'
      if (deps.now() - blurHiddenAt < MINI_MENU_BAR_BLUR_CLICK_MS) {
        blurHiddenAt = Number.NEGATIVE_INFINITY
        return 'none'
      }
      return 'show'
    },
    animating: () => animating,
    dispose: () => {
      stop()
      shown = false
    }
  }
}

export interface MenuBarSaved {
  /** The popout's size (null: the default). */
  size: { width: number; height: number } | null
  /** Pages living in the menu bar at the last save, oldest first (never private ones). */
  urls: string[]
}

/** The menu bar file as stored: anything unreadable is dropped. */
export function parseMenuBarSaved(value: unknown): MenuBarSaved {
  const record = typeof value === 'object' && value !== null ? value as Record<string, unknown> : {}
  const raw = record.size as Record<string, unknown> | undefined
  const width = typeof raw?.width === 'number' && Number.isFinite(raw.width) ? Math.round(raw.width) : 0
  const height = typeof raw?.height === 'number' && Number.isFinite(raw.height) ? Math.round(raw.height) : 0
  const size = width >= MINI_WINDOW_MIN_SIZE.width && height >= MINI_WINDOW_MIN_SIZE.height && width <= 10000 && height <= 10000 ? { width, height } : null
  const urls = Array.isArray(record.urls) ? record.urls.filter((url): url is string => typeof url === 'string' && url.length <= 8192 && canPopOutUrl(url)).slice(0, MINI_WINDOW_MAX) : []
  return { size, urls }
}

/**
 * After a restart the menu bar minis' tabs come back as ordinary tabs at the end of their windows
 * (that is how every mini window tab is saved). Pick them back out: for each saved URL, the last
 * restored tab with that URL not already picked. Tab ids in `urls`' order (missing ones skipped).
 */
export function pickRestoredMenuBarTabs(urls: readonly string[], candidates: ReadonlyArray<{ tabId: string; url: string }>): string[] {
  const taken = new Set<string>()
  const picked: string[] = []
  for (const url of urls) {
    const match = [...candidates].reverse().find((candidate) => candidate.url === url && !taken.has(candidate.tabId))
    if (!match) continue
    taken.add(match.tabId)
    picked.push(match.tabId)
  }
  return picked
}
