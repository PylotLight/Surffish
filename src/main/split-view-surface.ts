import { screen, WebContentsView, type BaseWindow, type WebContents } from 'electron'
import type { BrowserBounds } from '../shared/types'
import { splitDividerAt, splitPaneAt, type SplitLayout } from '../shared/split-view'
import { bindContentsToWindow } from './window-scope'

/**
 * The surface behind a split view: one small local WebContentsView per window, under the page
 * views and the size of the page area. Pages are inset a little in a split, so this is what shows
 * in the gaps: the divider handle between panes and the ring around the focused pane.
 *
 * It has no preload and no IPC: main reads its mouse input with before-mouse-event and pushes the
 * layout in with executeJavaScript (like the link status pill). While the divider is dragged the
 * pointer is usually over a page view; macOS and Chromium keep delivering the drag to the view
 * that got the mouse down, and a cursor poll covers platforms that don't.
 */

const SURFACE_DOCUMENT = `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<style>
html,body{margin:0;padding:0;width:100%;height:100%;overflow:hidden;background:#111418;-webkit-user-select:none;user-select:none;cursor:default}
.ring{position:absolute;box-sizing:border-box;border:2px solid rgba(126,226,168,.78);border-radius:6px;pointer-events:none;transition:left .12s,width .12s}
.ring.idle{border-color:rgba(255,255,255,.07)}
.divider{position:absolute;cursor:col-resize;display:flex;align-items:center;justify-content:center}
.divider::after{content:"";width:4px;height:38px;border-radius:3px;background:rgba(255,255,255,.22);transition:background .12s,height .12s}
.divider:hover::after,.divider.dragging::after{background:rgba(126,226,168,.9);height:56px}
</style></head><body><script>
window.__layout = (state) => {
  document.body.textContent = ''
  if (!state) return true
  state.cells.forEach((cell, index) => {
    const ring = document.createElement('div')
    ring.className = 'ring' + (index === state.focused ? '' : ' idle')
    Object.assign(ring.style, { left: cell.x + 'px', top: cell.y + 'px', width: cell.width + 'px', height: cell.height + 'px' })
    document.body.appendChild(ring)
  })
  state.dividers.forEach((divider, index) => {
    const handle = document.createElement('div')
    handle.className = 'divider' + (index === state.dragging ? ' dragging' : '')
    handle.title = 'Drag to resize · double-click to reset'
    Object.assign(handle.style, { left: divider.x + 'px', top: divider.y + 'px', width: divider.width + 'px', height: divider.height + 'px' })
    document.body.appendChild(handle)
  })
  return true
}
</script></body></html>`

export interface SplitSurfaceState {
  /** The page area (window coordinates); the surface covers it. */
  bounds: BrowserBounds
  /** Pane/divider rects in window coordinates. */
  layout: SplitLayout
  focusedIndex: number
}

export interface SplitSurfaceHandlers {
  /** Divider `index` dragged so its centre is at window x. */
  resize: (index: number, x: number) => void
  resizeEnd: () => void
  /** Double-click on a divider. */
  reset: (index: number) => void
  /** Mouse down in a pane's margin. */
  focusPane: (index: number) => void
}

interface Surface {
  window: BaseWindow
  view: WebContentsView | null
  ready: Promise<void> | null
  state: SplitSurfaceState | null
  handlers: SplitSurfaceHandlers | null
  drag: { index: number; poll: ReturnType<typeof setInterval> | null; lastX: number; startedAt: number; lastEventAt: number; cursorBaseline: number | null } | null
  renderScheduled: boolean
}

const surfaces = new Map<BaseWindow, Surface>()
const DRAG_POLL_MS = 16
const DRAG_MAX_MS = 60_000

function surfaceFor(window: BaseWindow): Surface {
  let surface = surfaces.get(window)
  if (!surface) {
    surface = { window, view: null, ready: null, state: null, handlers: null, drag: null, renderScheduled: false }
    surfaces.set(window, surface)
    window.once('closed', () => destroySplitSurface(window))
  }
  return surface
}

export function setSplitSurfaceHandlers(window: BaseWindow, handlers: SplitSurfaceHandlers | null): void {
  surfaceFor(window).handlers = handlers
}

function toWindow(surface: Surface, x: number, y: number): { x: number; y: number } {
  const bounds = surface.state?.bounds ?? { x: 0, y: 0 }
  return { x: x + bounds.x, y: y + bounds.y }
}

function stopDrag(surface: Surface, commit: boolean): void {
  const drag = surface.drag
  if (!drag) return
  surface.drag = null
  if (drag.poll) clearInterval(drag.poll)
  scheduleRender(surface)
  if (commit) surface.handlers?.resizeEnd()
}

/** Cursor x in window content coordinates (the poll fallback for platforms that don't capture the drag). */
function cursorWindowX(window: BaseWindow): number | null {
  try {
    if (window.isDestroyed()) return null
    const point = screen.getCursorScreenPoint()
    return point.x - window.getContentBounds().x
  } catch {
    return null
  }
}

function startDrag(surface: Surface, index: number, x: number): void {
  stopDrag(surface, false)
  const now = Date.now()
  const drag: NonNullable<Surface['drag']> = { index, poll: null, lastX: x, startedAt: now, lastEventAt: now, cursorBaseline: cursorWindowX(surface.window) }
  surface.drag = drag
  // Fallback only: when no captured mouse moves arrive, follow the real cursor once it moves.
  drag.poll = setInterval(() => {
    if (surface.drag !== drag) return
    if (Date.now() - drag.startedAt > DRAG_MAX_MS) return stopDrag(surface, true)
    if (Date.now() - drag.lastEventAt < 120) return
    const cursorX = cursorWindowX(surface.window)
    if (cursorX === null) return
    if (drag.cursorBaseline === null || Math.abs(cursorX - drag.cursorBaseline) < 1) {
      drag.cursorBaseline ??= cursorX
      return
    }
    drag.cursorBaseline = cursorX
    if (Math.abs(cursorX - drag.lastX) < 1) return
    drag.lastX = cursorX
    surface.handlers?.resize(drag.index, cursorX)
  }, DRAG_POLL_MS)
  scheduleRender(surface)
}

function handleMouse(surface: Surface, input: Electron.MouseInputEvent): void {
  const state = surface.state
  if (!state) return
  const point = toWindow(surface, input.x, input.y)
  if (input.type === 'mouseDown' && input.button === 'left') {
    const divider = splitDividerAt(state.layout, point.x, point.y)
    if (divider >= 0) {
      if ((input.clickCount ?? 1) >= 2) {
        stopDrag(surface, false)
        surface.handlers?.reset(divider)
        return
      }
      startDrag(surface, divider, point.x)
      return
    }
    const pane = splitPaneAt(state.layout, point.x, point.y)
    if (pane >= 0) surface.handlers?.focusPane(pane)
    return
  }
  const drag = surface.drag
  if (!drag) return
  if (input.type === 'mouseMove') {
    // The button came up somewhere we didn't see (outside the window): the drag is over.
    if (!leftButtonDown(input)) return stopDrag(surface, true)
    drag.lastEventAt = Date.now()
    drag.cursorBaseline = cursorWindowX(surface.window)
    if (Math.abs(point.x - drag.lastX) < 1) return
    drag.lastX = point.x
    surface.handlers?.resize(drag.index, point.x)
  } else if (input.type === 'mouseUp') {
    if (Math.abs(point.x - drag.lastX) >= 1) surface.handlers?.resize(drag.index, point.x)
    stopDrag(surface, true)
  }
}

/** False only when the event says the button is up (before-mouse-event doesn't always report modifiers). */
function leftButtonDown(input: Electron.MouseInputEvent): boolean {
  const modifiers = input.modifiers
  if (!modifiers || modifiers.length === 0) return true
  return modifiers.some((modifier) => modifier.toLowerCase() === 'leftbuttondown')
}

/**
 * A page view's mouse input while a divider drag may be running: on platforms that don't keep the
 * drag on the surface, the button going up (or a move with it already up) over a page ends it.
 */
export function notifySplitPagePointer(window: BaseWindow, input: Electron.MouseInputEvent): void {
  const surface = surfaces.get(window)
  if (!surface?.drag) return
  if (input.type === 'mouseUp' || (input.type === 'mouseMove' && !leftButtonDown(input))) stopDrag(surface, true)
}

export function isSplitDividerDragging(window: BaseWindow): boolean {
  return Boolean(surfaces.get(window)?.drag)
}

function ensureView(surface: Surface): WebContentsView | null {
  if (surface.view && !surface.view.webContents.isDestroyed()) return surface.view
  if (surface.window.isDestroyed()) return null
  const view = new WebContentsView({
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      javascript: true,
      backgroundThrottling: false,
      spellcheck: false
    }
  })
  view.setBackgroundColor('#111418')
  const contents = view.webContents
  bindContentsToWindow(contents, surface.window)
  contents.setWindowOpenHandler(() => ({ action: 'deny' }))
  contents.on('will-navigate', (event) => event.preventDefault())
  contents.on('before-input-event', (event) => event.preventDefault())
  contents.on('context-menu', (event) => event.preventDefault())
  contents.on('before-mouse-event', (_event, input) => handleMouse(surface, input))
  contents.on('render-process-gone', () => {
    if (surface.view !== view) return
    surface.view = null
    surface.ready = null
  })
  surface.view = view
  surface.ready = contents.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(SURFACE_DOCUMENT)}`).catch(() => undefined)
  return view
}

/** Keep the surface at the very bottom of the window, under every page view. */
function placeAtBottom(window: BaseWindow, view: WebContentsView): void {
  const children = window.contentView.children
  if (children[0] === view) return
  if (children.includes(view)) window.contentView.removeChildView(view)
  window.contentView.addChildView(view, 0)
}

function localState(state: SplitSurfaceState, dragging: number): Record<string, unknown> {
  const { bounds, layout } = state
  const local = (rect: BrowserBounds): BrowserBounds => ({ x: rect.x - bounds.x, y: rect.y - bounds.y, width: rect.width, height: rect.height })
  return { cells: layout.cells.map(local), dividers: layout.dividers.map(local), focused: state.focusedIndex, dragging }
}

function scheduleRender(surface: Surface): void {
  if (surface.renderScheduled) return
  surface.renderScheduled = true
  setImmediate(() => {
    surface.renderScheduled = false
    const view = surface.view
    const state = surface.state
    if (!view || view.webContents.isDestroyed() || !state) return
    const payload = JSON.stringify(localState(state, surface.drag?.index ?? -1))
    void (surface.ready ?? Promise.resolve()).then(() => {
      if (surface.view !== view || view.webContents.isDestroyed()) return
      return view.webContents.executeJavaScript(`window.__layout(${payload})`, true)
    }).catch(() => undefined)
  })
}

/** Show the surface for a split (or take it off screen with null). Call after the page views are placed. */
export function updateSplitSurface(window: BaseWindow, state: SplitSurfaceState | null): void {
  if (window.isDestroyed()) return
  const surface = surfaceFor(window)
  if (!state || state.bounds.width <= 0 || state.bounds.height <= 0) {
    surface.state = null
    stopDrag(surface, false)
    const view = surface.view
    if (view && window.contentView.children.includes(view)) {
      view.setVisible(false)
      window.contentView.removeChildView(view)
    }
    return
  }
  surface.state = state
  const view = ensureView(surface)
  if (!view) return
  placeAtBottom(window, view)
  view.setBounds(state.bounds)
  if (!view.getVisible()) view.setVisible(true)
  scheduleRender(surface)
}

export function destroySplitSurface(window: BaseWindow): void {
  const surface = surfaces.get(window)
  if (!surface) return
  stopDrag(surface, false)
  surfaces.delete(window)
  const view = surface.view
  surface.view = null
  if (view && !view.webContents.isDestroyed()) {
    if (!window.isDestroyed() && window.contentView.children.includes(view)) window.contentView.removeChildView(view)
    view.webContents.close()
  }
}

/** The surface's web contents (smoke tests drive the divider through it). */
export function getSplitSurfaceContents(window: BaseWindow): WebContents | null {
  const view = surfaces.get(window)?.view
  return view && !view.webContents.isDestroyed() ? view.webContents : null
}
