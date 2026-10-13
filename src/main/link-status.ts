import { WebContentsView } from 'electron'
import type { BrowserBounds } from '../shared/types'
import { addViewAbovePages, isNativeOverlayMode } from './browser-shell'

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

let view: WebContentsView | null = null
let ready: Promise<void> | null = null
let currentText = ''
let pillWidth = 0
let pointer: { x: number; y: number } | null = null
let pageBounds: BrowserBounds = { x: 0, y: 0, width: 0, height: 0 }
let hideTimer: ReturnType<typeof setTimeout> | null = null
let generation = 0

function ensureView(): WebContentsView | null {
  if (view && !view.webContents.isDestroyed()) return view
  const created = new WebContentsView({
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      javascript: true,
      transparent: true,
      backgroundThrottling: false,
      spellcheck: false
    }
  })
  created.setBackgroundColor('#00000000')
  created.setVisible(false)
  created.setBounds({ x: 0, y: 0, width: 0, height: 0 })
  created.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  created.webContents.on('will-navigate', (event) => event.preventDefault())
  created.webContents.on('render-process-gone', () => {
    if (view === created) {
      view = null
      ready = null
    }
  })
  if (!addViewAbovePages(created)) {
    created.webContents.close()
    return null
  }
  view = created
  ready = created.webContents.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(STATUS_DOCUMENT)}`).catch(() => undefined)
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

function layout(): void {
  if (!view || view.webContents.isDestroyed()) return
  if (!currentText || pillWidth <= 0 || pageBounds.width <= 0 || pageBounds.height <= 0 || !isNativeOverlayMode()) {
    view.setVisible(false)
    return
  }
  const width = Math.min(pillWidth, PILL_MAX_WIDTH, Math.max(0, pageBounds.width - PILL_MARGIN * 2))
  const onRight = pointerNearLeftPill(width)
  const x = onRight ? pageBounds.x + pageBounds.width - width - PILL_MARGIN : pageBounds.x + PILL_MARGIN
  const y = pageBounds.y + pageBounds.height - PILL_HEIGHT - PILL_MARGIN
  view.setBounds({ x: Math.round(x), y: Math.round(y), width: Math.round(width), height: PILL_HEIGHT })
  view.setVisible(true)
}

function clearHideTimer(): void {
  if (hideTimer) clearTimeout(hideTimer)
  hideTimer = null
}

/** Show `url` in the pill over the page at `bounds` (window coordinates); an empty url hides it. */
export function showLinkStatus(url: string, bounds: BrowserBounds): void {
  pageBounds = { ...bounds }
  if (!url) {
    hideLinkStatus(true)
    return
  }
  clearHideTimer()
  const text = displayText(url)
  const target = ensureView()
  if (!target || !ready) return
  if (text === currentText && pillWidth > 0) {
    layout()
    return
  }
  currentText = text
  const token = ++generation
  void ready.then(() => target.webContents.isDestroyed()
    ? 0
    : target.webContents.executeJavaScript(`window.__setStatus(${JSON.stringify(text)})`, false)
  ).then((measured: unknown) => {
    if (token !== generation || view !== target) return
    pillWidth = typeof measured === 'number' && Number.isFinite(measured) ? measured : 0
    layout()
  }).catch(() => undefined)
}

/** Hide the pill. Hover changes arrive as "" then the next url, so by default wait a beat to avoid flicker. */
export function hideLinkStatus(deferred = false): void {
  clearHideTimer()
  const hide = (): void => {
    generation += 1
    currentText = ''
    pillWidth = 0
    if (view && !view.webContents.isDestroyed()) view.setVisible(false)
  }
  if (deferred) hideTimer = setTimeout(() => { hideTimer = null; hide() }, HIDE_DELAY_MS)
  else hide()
}

function pointerNearLeftPill(width: number): boolean {
  if (!pointer) return false
  const nearBottom = pointer.y >= pageBounds.height - PILL_HEIGHT - PILL_MARGIN - AVOID_PADDING
  const overLeft = pointer.x <= PILL_MARGIN + width + AVOID_PADDING
  const overRight = pointer.x >= pageBounds.width - PILL_MARGIN - width - AVOID_PADDING
  // On a page too narrow for either corner to be clear, stay on the left.
  return nearBottom && overLeft && !overRight
}

/** Pointer moved over the page (page coordinates): keep the pill out from under it. */
export function avoidLinkStatusPointer(x: number, y: number): void {
  const before = pillWidth > 0 && pointerNearLeftPill(Math.min(pillWidth, PILL_MAX_WIDTH))
  pointer = { x, y }
  if (!currentText || pillWidth <= 0) return
  if (pointerNearLeftPill(Math.min(pillWidth, PILL_MAX_WIDTH)) !== before) layout()
}

export function destroyLinkStatus(): void {
  clearHideTimer()
  generation += 1
  currentText = ''
  pillWidth = 0
  const closing = view
  view = null
  ready = null
  if (closing && !closing.webContents.isDestroyed()) closing.webContents.close()
}

/** Briefly show a short message (not a url) in the status pill, e.g. "Image copied". */
export function flashLinkStatus(message: string, bounds: BrowserBounds, durationMs = 1400): void {
  showLinkStatus(message, bounds)
  clearHideTimer()
  hideTimer = setTimeout(() => { hideTimer = null; hideLinkStatus() }, durationMs)
}
