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
/**
 * Start-up phase marks as [label, epoch ms], oldest first. Always recorded (a handful of entries,
 * one Date.now() each) and read in-process by the perf bench (scripts/perf/bench.cjs) to break cold
 * start into phases; the global name is the contract with the bench.
 */
const marks: [string, number][] = []
;(globalThis as { __surffishStartupMarks?: [string, number][] }).__surffishStartupMarks = marks
/** Records a start-up phase; SURFFISH_STARTUP_TRACE=1 also prints it (ms since main loaded). */
export function traceStartup(label: string): void {
  const now = Date.now()
  marks.push([label, now])
  if (process.env.SURFFISH_STARTUP_TRACE) console.info(`[startup] ${label} +${now - traceStart} ms`)
}
