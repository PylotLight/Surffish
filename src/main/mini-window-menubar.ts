import { Menu, Tray, nativeImage, type MenuItemConstructorOptions, type NativeImage } from 'electron'
import { menuBarTrayTitle, menuBarTrayTooltip, wantsMenuBarTray } from '../shared/mini-window-menubar'
import type { MiniRect, MiniWindowMenuBarIcon } from '../shared/mini-window'
import { MENU_BAR_ICON_COLOR, MENU_BAR_ICON_TEMPLATE } from './mini-window-menubar-icon'

/**
 * The menu bar icon (one Tray status item; the system tray on Windows/Linux) for mini windows that
 * live in the menu bar (shared/mini-window-menubar.ts; the windows themselves are mini-window.ts's).
 * Part of the lazy mini window chunk. No Tray exists while it isn't wanted (Settings → Mini window →
 * Menu bar icon: 'in-use' with nothing there, or 'never'), so nothing runs for it then.
 *
 * Left click shows/hides the popout (mini-window.ts anchors it under the icon); right click (macOS,
 * Windows) pops up the menu: the menu bar minis to pick from, Pin, Return to Window, Move to Edge,
 * Settings, Hide Menu Bar Icon. Linux trays (StatusNotifierItem) mostly only show a menu, so there it
 * is set as the context menu and also carries Show/Hide. No hover peek (Tray hover is unreliable).
 * The title beside the icon (macOS) shows the count with two or more and ♪ while one plays.
 */

export interface MenuBarTrayEntry {
  key: number
  title: string
  shown: boolean
  pinned: boolean
  /** The one a click shows (the last shown). */
  current: boolean
}

export interface MenuBarTrayHost {
  mode(): MiniWindowMenuBarIcon
  entries(): MenuBarTrayEntry[]
  playing(): boolean
  /** Left click on the icon (its bounds; null when the platform gives none). */
  click(anchor: MiniRect | null): void
  show(key: number, anchor: MiniRect | null): void
  hide(key: number): void
  togglePin(key: number): void
  returnToBrowser(key: number): void
  moveToEdge(key: number): void
  canMoveToEdge(): boolean
  /** With nothing in the menu bar ('always'): put the browser's current tab there. */
  sendCurrentTab(): void
  canSendCurrentTab(): boolean
  openSettings(): void
  hideIcon(): void
}

const IS_MAC = process.platform === 'darwin'
const IS_LINUX = process.platform === 'linux'

let tray: Tray | null = null
let trayHost: MenuBarTrayHost | null = null
let shownTitle: string | null = null
let shownTooltip: string | null = null
let linuxMenuKey = ''
/** The last menu built (the smoke drives its items through the test hook). */
let lastTemplate: MenuItemConstructorOptions[] = []

function icon(): NativeImage {
  const [one, two] = IS_MAC ? MENU_BAR_ICON_TEMPLATE : MENU_BAR_ICON_COLOR
  const image = nativeImage.createFromBuffer(Buffer.from(one, 'base64'), { scaleFactor: 1 })
  image.addRepresentation({ scaleFactor: 2, buffer: Buffer.from(two, 'base64') })
  if (IS_MAC) image.setTemplateImage(true)
  return image
}

function bounds(): MiniRect | null {
  try {
    const rect = tray && !tray.isDestroyed() ? tray.getBounds() : null
    return rect && rect.width > 0 && rect.height > 0 ? rect : null
  } catch {
    return null
  }
}

/** The icon's bounds right now (null: none, or the platform doesn't say). */
export function menuBarTrayBounds(): MiniRect | null {
  return bounds()
}

function clip(title: string): string {
  return title.length > 48 ? `${title.slice(0, 47)}…` : title
}

function buildTemplate(host: MenuBarTrayHost): MenuItemConstructorOptions[] {
  const entries = host.entries()
  const current = entries.find((entry) => entry.current) ?? entries.at(-1) ?? null
  const items: MenuItemConstructorOptions[] = entries.map((entry) => ({
    label: clip(entry.title || 'Mini Window'),
    type: entries.length > 1 ? 'radio' : 'normal',
    checked: entries.length > 1 && entry === current,
    click: () => host.show(entry.key, bounds())
  }))
  if (current) {
    if (IS_LINUX || current.shown) items.push({ label: current.shown ? 'Hide Mini Window' : 'Show Mini Window', click: () => (current.shown ? host.hide(current.key) : host.show(current.key, bounds())) })
    items.push(
      { type: 'separator' },
      { label: 'Pin Mini Window', type: 'checkbox', checked: current.pinned, click: () => host.togglePin(current.key) },
      { label: 'Return to Window', click: () => host.returnToBrowser(current.key) },
      { label: 'Move to Edge', enabled: host.canMoveToEdge(), click: () => host.moveToEdge(current.key) }
    )
  } else {
    items.push({ label: 'Open Current Tab in Menu Bar', enabled: host.canSendCurrentTab(), click: () => host.sendCurrentTab() })
  }
  items.push(
    { type: 'separator' },
    { label: 'Mini Window Settings…', click: () => host.openSettings() },
    { label: IS_MAC ? 'Hide Menu Bar Icon' : 'Hide Tray Icon', click: () => host.hideIcon() }
  )
  return items
}

function popUpMenu(): void {
  if (!tray || tray.isDestroyed() || !trayHost) return
  lastTemplate = buildTemplate(trayHost)
  tray.popUpContextMenu(Menu.buildFromTemplate(lastTemplate))
}

function onClick(): void {
  if (!trayHost) return
  // Nothing there yet ('always'): the menu offers to send the current tab.
  if (trayHost.entries().length === 0) return popUpMenu()
  trayHost.click(bounds())
}

function create(): Tray {
  const created = new Tray(icon())
  created.on('click', onClick)
  // macOS: ctrl-click arrives as a right click too.
  created.on('right-click', popUpMenu)
  return created
}

function destroy(): void {
  if (tray && !tray.isDestroyed()) tray.destroy()
  tray = null
  shownTitle = null
  shownTooltip = null
  linuxMenuKey = ''
}

/** Create, update or remove the icon to match what lives in the menu bar (cheap when nothing changed). */
export function syncMenuBarTray(host: MenuBarTrayHost): void {
  trayHost = host
  const entries = host.entries()
  if (!wantsMenuBarTray(host.mode(), entries.length)) return destroy()
  try {
    tray ??= create()
  } catch (error) {
    console.warn('Could not create the menu bar icon:', error)
    tray = null
    return
  }
  const playing = host.playing()
  const title = menuBarTrayTitle(entries.length, playing)
  if (title !== shownTitle) {
    shownTitle = title
    // macOS draws it beside the icon; elsewhere it is a no-op (the tooltip says the same).
    if (IS_MAC) tray.setTitle(title, { fontType: 'monospacedDigit' })
  }
  const tooltip = menuBarTrayTooltip(entries.map((entry) => entry.title), playing)
  if (tooltip !== shownTooltip) {
    shownTooltip = tooltip
    tray.setToolTip(tooltip)
  }
  if (IS_LINUX) {
    // Most Linux trays never send clicks: the menu is the way in, kept current.
    const key = JSON.stringify([entries, host.canSendCurrentTab(), host.canMoveToEdge()])
    if (key !== linuxMenuKey) {
      linuxMenuKey = key
      lastTemplate = buildTemplate(host)
      tray.setContextMenu(Menu.buildFromTemplate(lastTemplate))
    }
  }
}

interface MenuBarTestHook {
  exists(): boolean
  title(): string | null
  tooltip(): string | null
  /** A left click on the icon (`anchor`: the icon's bounds, as a real click reports them). */
  click(anchor?: MiniRect | null): void
  /** The right-click menu as it would show now: labels, types, checked/enabled. */
  menu(): Array<{ label: string; type: string; checked: boolean; enabled: boolean }>
  clickMenu(label: string): boolean
}

// Smokes can't click a Tray under Xvfb: they drive the same code paths through this (lazy chunk only).
const hook: MenuBarTestHook = {
  exists: () => Boolean(tray && !tray.isDestroyed()),
  title: () => shownTitle,
  tooltip: () => shownTooltip,
  click: (anchor) => {
    if (!trayHost || !tray) return
    if (trayHost.entries().length === 0) return
    trayHost.click(anchor === undefined ? bounds() : anchor)
  },
  menu: () => {
    if (!trayHost) return []
    lastTemplate = buildTemplate(trayHost)
    return lastTemplate.map((item) => ({ label: item.label ?? '', type: item.type ?? 'normal', checked: item.checked === true, enabled: item.enabled !== false }))
  },
  clickMenu: (label) => {
    const item = lastTemplate.find((candidate) => candidate.label === label)
    if (!item?.click || item.enabled === false) return false
    ;(item.click as () => void)()
    return true
  }
}
;(globalThis as { __surffishMiniMenuBar?: MenuBarTestHook }).__surffishMiniMenuBar = hook
