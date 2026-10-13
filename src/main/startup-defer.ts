import type { BaseWindow } from 'electron'
import { getWindowRenderers } from './browser-shell'

/**
 * Start-up work that can wait for the first window: run it once the window is on screen and its
 * surfaces have drawn a frame. The main process runs on the browser UI thread, so a long
 * synchronous task (the 11 MB ad-filter engine deserialize) started earlier would hold the
 * first frame back.
 */
export async function afterFirstWindowPaint(window: BaseWindow | undefined, timeoutMs = 500): Promise<void> {
  if (!window || window.isDestroyed()) return
  if (!window.isVisible()) {
    await new Promise<void>((resolve) => {
      window.once('show', () => resolve())
      window.once('closed', () => resolve())
    })
  }
  if (window.isDestroyed()) return
  // Two animation frames in any surface on screen (hidden ones never tick; the timeout covers
  // a window that is shown but occluded): the frame after load has been produced.
  const framed = Promise.any(getWindowRenderers(window).map((contents) => contents
    .executeJavaScript('new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))')))
    .catch(() => undefined)
  await Promise.race([framed, new Promise((resolve) => setTimeout(resolve, timeoutMs))])
}

const traceStart = Date.now()
/** SURFFISH_STARTUP_TRACE=1 prints start-up phase times (ms since main loaded). */
export function traceStartup(label: string): void {
  if (process.env.SURFFISH_STARTUP_TRACE) console.info(`[startup] ${label} +${Date.now() - traceStart} ms`)
}
