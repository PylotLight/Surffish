import { app, webContents as allWebContents, type WebContents } from 'electron'
import {
  countStabilityEvent,
  emptyStabilityCounters,
  errorSignature,
  LogThrottle,
  RecoveryBudget,
  stabilityFailureTotal,
  type StabilityCounters
} from '../shared/stability'
import { stallLogActive, stallLogContentsEvent, stallLogEvent } from './stall-logger'

/**
 * Main-process crash guard (installed first thing in index.ts):
 *
 * - Uncaught exceptions and unhandled rejections are logged (throttled per message) and counted
 *   instead of Electron's modal "A JavaScript error occurred in the main process" dialog, which
 *   blocks the UI until dismissed. The browser keeps running: one failed handler must not take
 *   every window down with it.
 * - Renderer and child-process deaths are counted; after a GPU process crash every surface is
 *   repainted (Chromium relaunches the GPU process, but views it doesn't know are dirty can stay
 *   blank or stale until something else invalidates them).
 * - The app's own surfaces (toolbar, sidebar, content) reload when their renderer dies, at most a
 *   few times a minute; a toolbar surface hung for SHELL_HANG_RECOVERY_MS is restarted the same way.
 *   Site tabs keep their own crash screen (tab-health.ts).
 *
 * Counters are on `globalThis.__surffishStability` for smokes and the perf bench.
 */

const counters: StabilityCounters = emptyStabilityCounters()
const throttle = new LogThrottle()
const shellSurfaces = new WeakSet<WebContents>()
const tabContents = new WeakSet<WebContents>()
let installed = false

/** A shell surface still hung after this long is restarted (a hung toolbar locks the whole window). */
const SHELL_HANG_RECOVERY_MS = 15_000
const SHELL_RELOAD_DELAY_MS = 250
const GPU_REPAINT_DELAY_MS = 750

function logThrottled(kind: string, error: unknown): void {
  const signature = `${kind} ${errorSignature(error)}`
  // Debug logging (stall-logger.ts): every occurrence, signature only.
  if (stallLogActive()) stallLogEvent('main-error', signature.slice(0, 300))
  const occurrence = throttle.shouldLog(signature)
  if (!occurrence) return
  const suffix = occurrence > 1 ? ` (seen ${occurrence}×)` : ''
  try {
    console.error(`[crash guard] ${kind}${suffix}:`, error)
  } catch {
    // stdout/stderr closed (the parent terminal went away): nothing more to do.
  }
}

/** Count and log a main-process failure that was caught somewhere (e.g. an ipcMain.on listener). */
export function reportMainError(kind: 'ipcListenerErrors', error: unknown, context: string): void {
  countStabilityEvent(counters, kind, `${context}: ${errorSignature(error)}`)
  logThrottled(context, error)
}

/** Site tab webContents (tab-health.ts): their deaths count as tab crashes. */
export function markTabContents(contents: WebContents): void {
  tabContents.add(contents)
}

function describe(contents: WebContents): string {
  try {
    if (contents.isDestroyed()) return 'destroyed'
    const url = contents.getURL()
    const surface = /[?&]surface=([a-z-]+)/.exec(url)?.[1]
    if (surface) return `shell:${surface}`
    try {
      const parsed = new URL(url)
      return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.host : `${parsed.protocol}${parsed.host}`
    } catch {
      return url.slice(0, 40) || contents.getType()
    }
  } catch {
    return 'webContents'
  }
}

/**
 * Keep an app surface alive: reload it when its renderer dies, and restart it when it hangs.
 * `reload` loads the surface's document again; `isLive` says whether its window is still open.
 */
export function watchShellSurface(contents: WebContents, reload: () => Promise<void>, isLive: () => boolean): void {
  shellSurfaces.add(contents)
  const budget = new RecoveryBudget(3, 60_000)
  let hangTimer: ReturnType<typeof setTimeout> | null = null
  const clearHang = (): void => {
    if (hangTimer) clearTimeout(hangTimer)
    hangTimer = null
  }
  const recover = (why: string): void => {
    if (!isLive() || contents.isDestroyed()) return
    if (!budget.tryTake()) {
      console.error(`[crash guard] ${describe(contents)} ${why} again; not reloading it (more than 3 times in a minute).`)
      stallLogContentsEvent('recovery-skipped', contents, `${why} again (more than 3 times in a minute)`)
      return
    }
    setTimeout(() => {
      if (!isLive() || contents.isDestroyed()) return
      countStabilityEvent(counters, 'shellReloads', `${describe(contents)} after ${why}`)
      stallLogContentsEvent('recovery-reload', contents, `after ${why}`)
      reload().catch((error: unknown) => console.error(`[crash guard] could not reload ${describe(contents)}:`, error))
    }, SHELL_RELOAD_DELAY_MS)
  }
  contents.on('render-process-gone', (_event, details) => {
    clearHang()
    if (details.reason === 'clean-exit') return
    console.warn(`[crash guard] app surface ${describe(contents)} renderer gone (${details.reason}, exit ${details.exitCode}); reloading it`)
    recover(details.reason)
  })
  contents.on('unresponsive', () => {
    if (hangTimer) return
    hangTimer = setTimeout(() => {
      hangTimer = null
      // Paused in a debugger is not a hang.
      if (!isLive() || contents.isDestroyed() || contents.isDevToolsOpened()) return
      console.warn(`[crash guard] app surface ${describe(contents)} unresponsive for ${SHELL_HANG_RECOVERY_MS / 1000}s; restarting it`)
      stallLogContentsEvent('recovery-restart', contents, `unresponsive for ${SHELL_HANG_RECOVERY_MS / 1000}s`)
      // render-process-gone ('killed') follows and reloads it through the budget above.
      try {
        contents.forcefullyCrashRenderer()
      } catch (error) {
        console.error('[crash guard] could not restart the hung surface:', error)
      }
    }, SHELL_HANG_RECOVERY_MS)
    hangTimer.unref?.()
  })
  contents.on('responsive', clearHang)
  contents.once('destroyed', clearHang)
}

function repaintEverything(): void {
  for (const contents of allWebContents.getAllWebContents()) {
    try {
      if (!contents.isDestroyed() && !contents.isOffscreen()) contents.invalidate()
    } catch {
      // Being torn down.
    }
  }
}

export function installCrashGuard(): void {
  if (installed) return
  installed = true
  ;(globalThis as { __surffishStability?: StabilityCounters }).__surffishStability = counters

  process.on('uncaughtException', (error) => {
    countStabilityEvent(counters, 'uncaughtExceptions', errorSignature(error))
    logThrottled('uncaught exception in the main process', error)
  })
  process.on('unhandledRejection', (reason) => {
    countStabilityEvent(counters, 'unhandledRejections', errorSignature(reason))
    logThrottled('unhandled promise rejection in the main process', reason)
  })

  try {
    app.on('render-process-gone', (_event, contents, details) => {
      if (details.reason === 'clean-exit') return
      const key = shellSurfaces.has(contents) ? 'shellRendererGone' : tabContents.has(contents) ? 'tabRendererGone' : 'otherRendererGone'
      countStabilityEvent(counters, key, `${describe(contents)} ${details.reason} (exit ${details.exitCode})`)
      stallLogContentsEvent('renderer-gone', contents, `${details.reason} (exit ${details.exitCode})`)
    })
    app.on('child-process-gone', (_event, details) => {
      if (details.reason === 'clean-exit') return
      const summary = `${details.type}${details.name ? ` ${details.name}` : ''}${details.serviceName ? ` (${details.serviceName})` : ''} ${details.reason} (exit ${details.exitCode})`
      console.warn(`[crash guard] child process gone: ${summary}`)
      stallLogEvent(details.type === 'GPU' ? 'gpu-gone' : 'child-gone', summary)
      if (details.type === 'GPU') {
        countStabilityEvent(counters, 'gpuGone', summary)
        setTimeout(repaintEverything, GPU_REPAINT_DELAY_MS)
      } else {
        countStabilityEvent(counters, 'childGone', summary)
      }
    })
    app.on('web-contents-created', (_event, contents) => {
      contents.on('unresponsive', () => {
        countStabilityEvent(counters, 'unresponsive', describe(contents))
        stallLogContentsEvent('unresponsive', contents)
      })
      contents.on('responsive', () => stallLogContentsEvent('responsive', contents))
    })
    app.on('will-quit', () => {
      if (stabilityFailureTotal(counters) === 0) return
      const { recent: _recent, ...totals } = counters
      console.warn('[crash guard] this session:', JSON.stringify(totals))
    })
  } catch {
    // Unit tests import modules without a live Electron app.
  }
}

// Installed on import: index.ts imports this module first, so even errors thrown while other
// modules load are caught and logged.
installCrashGuard()
