import { screen, type BaseWindow } from 'electron'
import { createFrameLoop, frameIntervalFor, type MotionRect } from '../shared/mini-window-motion'

/**
 * The mini windows' shared frame loop (shared/mini-window-motion.ts), paced to the fastest connected
 * display's refresh rate (re-read when displays change). Part of the lazy mini-window chunk.
 */

let interval: number | null = null
let watching = false

function frameInterval(): number {
  if (interval !== null) return interval
  if (!watching) {
    watching = true
    const reset = (): void => { interval = null }
    screen.on('display-added', reset)
    screen.on('display-removed', reset)
    screen.on('display-metrics-changed', reset)
  }
  let hz = 0
  try {
    for (const display of screen.getAllDisplays()) hz = Math.max(hz, display.displayFrequency || 0)
  } catch { /* no displays yet */ }
  interval = frameIntervalFor(hz)
  return interval
}

export const motion = createFrameLoop({
  now: () => performance.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  interval: frameInterval
})

/**
 * Move `win` to `rect`: inside a frame, when the frame commits (one setBounds per window per frame,
 * so it moves in the same tick as everything else); outside one, right away. Skipped when already there.
 */
export function placeWindow(win: BaseWindow, rect: MotionRect): void {
  if (win.isDestroyed()) return
  if (motion.inTick()) {
    motion.place(win, rect, (next) => { if (!win.isDestroyed()) win.setBounds(next) }, () => (win.isDestroyed() ? null : win.getBounds()))
    return
  }
  motion.drop(win)
  const now = win.getBounds()
  if (now.x !== rect.x || now.y !== rect.y || now.width !== rect.width || now.height !== rect.height) win.setBounds(rect)
}
