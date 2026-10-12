import { app } from 'electron'

/**
 * Coalesces hot-path disk writes (session tabs, history, favicon cache, download progress) so a burst
 * of navigations or progress ticks becomes one write instead of dozens of synchronous main-thread
 * writes. Everything still pending is flushed synchronously when the app quits.
 */
const pending = new Map<string, { timer: ReturnType<typeof setTimeout>; run: () => void }>()
let quitHookInstalled = false

function runSafely(key: string, run: () => void): void {
  try {
    run()
  } catch (error) {
    console.error(`Deferred write "${key}" failed:`, error)
  }
}

export function deferWrite(key: string, run: () => void, delayMs = 800): void {
  installQuitHook()
  const existing = pending.get(key)
  if (existing) {
    existing.run = run
    return
  }
  const entry = {
    run,
    timer: setTimeout(() => {
      pending.delete(key)
      runSafely(key, entry.run)
    }, delayMs)
  }
  pending.set(key, entry)
}

export function flushDeferredWrites(): void {
  for (const [key, entry] of [...pending]) {
    clearTimeout(entry.timer)
    pending.delete(key)
    runSafely(key, entry.run)
  }
}

/** Drop a queued write, e.g. when the data it would persist was just cleared. */
export function cancelDeferredWrite(key: string): void {
  const entry = pending.get(key)
  if (!entry) return
  clearTimeout(entry.timer)
  pending.delete(key)
}

function installQuitHook(): void {
  if (quitHookInstalled) return
  quitHookInstalled = true
  try {
    app.on('will-quit', flushDeferredWrites)
  } catch {
    // Unit tests import modules without a live Electron app.
  }
}
