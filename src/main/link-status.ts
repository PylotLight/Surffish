import { WebContentsView, type BaseWindow } from 'electron'
import type { BrowserBounds } from '../shared/types'
import { addViewAbovePages, isNativeOverlayMode } from './browser-shell'
import { currentBrowserWindow } from './window-scope'

/**
 * Hovered-link status pill (bottom-left of the page, like Chrome's status bubble).
 *
 * Site pages are native views under the React overlays, so the pill is its own tiny transparent
 * WebContentsView, sized to the text. A native view takes the clicks inside its bounds, so it only
 * exists on screen while a link is hovered, and it jumps to the right-hand corner whenever the
 * pointer comes near it, so it never sits under the cursor.
 */

const PILL_HEIGHT = 22
const PILL_MARGIN = 4
const PILL_MAX_WIDTH = 520
const AVOID_PADDING = 24
const HIDE_DELAY_MS = 120

const STATUS_DOCUMENT = `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<style>
html,body{margin:0;padding:0;background:transparent;overflow:hidden;-webkit-user-select:none;user-select:none;cursor:default}
#pill{display:inline-block;box-sizing:border-box;max-width:${PILL_MAX_WIDTH}px;height:${PILL_HEIGHT}px;line-height:${PILL_HEIGHT - 2}px;padding:0 9px;
white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font:12px -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;
color:#e8ecef;background:rgba(24,28,33,.92);border:1px solid rgba(255,255,255,.12);border-radius:7px}
</style></head><body><span id="pill"></span><script>
window.__setStatus = (text) => { const pill = document.getElementById('pill'); pill.textContent = text; return Math.ceil(pill.getBoundingClientRect().width) }
</script></body></html>`

/** One pill per window; it lives in that window's view stack. */
interface LinkStatus {
  view: WebContentsView | null
  ready: Promise<void> | null
  currentText: string
  pillWidth: number
  pointer: { x: number; y: number } | null
  pageBounds: BrowserBounds
  hideTimer: ReturnType<typeof setTimeout> | null
  generation: number
}

const pills = new Map<BaseWindow, LinkStatus>()

function pillFor(window?: BaseWindow | null): LinkStatus | null {
  const target = window ?? currentBrowserWindow()
  if (!target || target.isDestroyed()) return null
  let pill = pills.get(target)
  if (!pill) {
    pill = { view: null, ready: null, currentText: '', pillWidth: 0, pointer: null, pageBounds: { x: 0, y: 0, width: 0, height: 0 }, hideTimer: null, generation: 0 }
    pills.set(target, pill)
    target.once('closed', () => destroyLinkStatus(target))
  }
  return pill
}

function ensureView(pill: LinkStatus, window: BaseWindow): WebContentsView | null {
  if (pill.view && !pill.view.webContents.isDestroyed()) return pill.view
  const created = new WebContentsView({
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      javascript: true,
      transparent: true,
      backgroundThrottling: false,
      spellcheck: false,
      disableWakeLocks: true
    }
  })
  created.setBackgroundColor('#00000000')
  created.setVisible(false)
  created.setBounds({ x: 0, y: 0, width: 0, height: 0 })
  created.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  created.webContents.on('will-navigate', (event) => event.preventDefault())
  created.webContents.on('render-process-gone', () => {
    if (pill.view === created) {
      pill.view = null
      pill.ready = null
    }
  })
  if (!addViewAbovePages(created, window)) {
    created.webContents.close()
    return null
  }
  pill.view = created
  pill.ready = created.webContents.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(STATUS_DOCUMENT)}`).catch(() => undefined)
  return created
}

function displayText(url: string): string {
  try {
    const parsed = new URL(url)
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      // Like Chrome: drop the scheme noise for https, keep it visible for plain http.
      const text = `${parsed.host}${parsed.pathname === '/' && !parsed.search && !parsed.hash ? '' : parsed.pathname}${parsed.search}${parsed.hash}`
      return parsed.protocol === 'http:' ? `http://${text}` : text
    }
  } catch {
    // Fall through to the raw value.
  }
  return url
}

function layout(pill: LinkStatus, window: BaseWindow): void {
  const { view, pageBounds } = pill
  if (!view || view.webContents.isDestroyed()) return
  if (!pill.currentText || pill.pillWidth <= 0 || pageBounds.width <= 0 || pageBounds.height <= 0 || !isNativeOverlayMode(window)) {
    view.setVisible(false)
    return
  }
  const width = Math.min(pill.pillWidth, PILL_MAX_WIDTH, Math.max(0, pageBounds.width - PILL_MARGIN * 2))
  const onRight = pointerNearLeftPill(pill, width)
  const x = onRight ? pageBounds.x + pageBounds.width - width - PILL_MARGIN : pageBounds.x + PILL_MARGIN
  const y = pageBounds.y + pageBounds.height - PILL_HEIGHT - PILL_MARGIN
  view.setBounds({ x: Math.round(x), y: Math.round(y), width: Math.round(width), height: PILL_HEIGHT })
  view.setVisible(true)
}

function clearHideTimer(pill: LinkStatus): void {
  if (pill.hideTimer) clearTimeout(pill.hideTimer)
  pill.hideTimer = null
}

/** Show `url` in the pill over the page at `bounds` (window coordinates); an empty url hides it. */
export function showLinkStatus(url: string, bounds: BrowserBounds, window?: BaseWindow | null): void {
  const target = window ?? currentBrowserWindow()
  const pill = pillFor(target)
  if (!pill || !target) return
  pill.pageBounds = { ...bounds }
  if (!url) {
    hideLinkStatus(true, target)
    return
  }
  clearHideTimer(pill)
  const text = displayText(url)
  const view = ensureView(pill, target)
  const ready = pill.ready
  if (!view || !ready) return
  if (text === pill.currentText && pill.pillWidth > 0) {
    layout(pill, target)
    return
  }
  pill.currentText = text
  const token = ++pill.generation
  void ready.then(() => view.webContents.isDestroyed()
    ? 0
    : view.webContents.executeJavaScript(`window.__setStatus(${JSON.stringify(text)})`, false)
  ).then((measured: unknown) => {
    if (token !== pill.generation || pill.view !== view) return
    pill.pillWidth = typeof measured === 'number' && Number.isFinite(measured) ? measured : 0
    layout(pill, target)
  }).catch(() => undefined)
}

/** Hide the pill. Hover changes arrive as "" then the next url, so by default wait a beat to avoid flicker. */
export function hideLinkStatus(deferred = false, window?: BaseWindow | null): void {
  const target = window ?? currentBrowserWindow()
  const pill = target ? pills.get(target) : undefined
  if (!pill) return
  clearHideTimer(pill)
  const hide = (): void => {
    pill.generation += 1
    pill.currentText = ''
    pill.pillWidth = 0
    if (pill.view && !pill.view.webContents.isDestroyed()) pill.view.setVisible(false)
  }
  if (deferred) pill.hideTimer = setTimeout(() => { pill.hideTimer = null; hide() }, HIDE_DELAY_MS)
  else hide()
}

function pointerNearLeftPill(pill: LinkStatus, width: number): boolean {
  const { pointer, pageBounds } = pill
  if (!pointer) return false
  const nearBottom = pointer.y >= pageBounds.height - PILL_HEIGHT - PILL_MARGIN - AVOID_PADDING
  const overLeft = pointer.x <= PILL_MARGIN + width + AVOID_PADDING
  const overRight = pointer.x >= pageBounds.width - PILL_MARGIN - width - AVOID_PADDING
  // On a page too narrow for either corner to be clear, stay on the left.
  return nearBottom && overLeft && !overRight
}

/** Pointer moved over the page (page coordinates): keep the pill out from under it. */
export function avoidLinkStatusPointer(x: number, y: number, window?: BaseWindow | null): void {
  const target = window ?? currentBrowserWindow()
  const pill = target ? pills.get(target) : undefined
  if (!pill || !target) return
  const before = pill.pillWidth > 0 && pointerNearLeftPill(pill, Math.min(pill.pillWidth, PILL_MAX_WIDTH))
  pill.pointer = { x, y }
  if (!pill.currentText || pill.pillWidth <= 0) return
  if (pointerNearLeftPill(pill, Math.min(pill.pillWidth, PILL_MAX_WIDTH)) !== before) layout(pill, target)
}

/** Diagnostics: the pills' web contents ids (each runs in its own small renderer once created). */
export function getLinkStatusContentsIds(): number[] {
  return [...pills.values()].flatMap((pill) => pill.view && !pill.view.webContents.isDestroyed() ? [pill.view.webContents.id] : [])
}

export function destroyLinkStatus(window?: BaseWindow | null): void {
  const target = window ?? currentBrowserWindow()
  const pill = target ? pills.get(target) : undefined
  if (!pill || !target) return
  pills.delete(target)
  clearHideTimer(pill)
  pill.generation += 1
  pill.currentText = ''
  pill.pillWidth = 0
  const closing = pill.view
  pill.view = null
  pill.ready = null
  if (closing && !closing.webContents.isDestroyed()) closing.webContents.close()
}

/** Briefly show a short message (not a url) in the status pill, e.g. "Image copied". */
export function flashLinkStatus(message: string, bounds: BrowserBounds, durationMs = 1400, window?: BaseWindow | null): void {
  const target = window ?? currentBrowserWindow()
  showLinkStatus(message, bounds, target)
  const pill = target ? pills.get(target) : undefined
  if (!pill) return
  clearHideTimer(pill)
  pill.hideTimer = setTimeout(() => { pill.hideTimer = null; hideLinkStatus(false, target) }, durationMs)
}
