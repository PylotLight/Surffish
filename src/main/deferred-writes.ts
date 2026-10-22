import { app } from "electron";

/**
 * Coalesces hot-path disk writes (session tabs, history, favicon cache, download progress) so a burst
 * of navigations or progress ticks becomes one write instead of dozens of synchronous main-thread
 * writes. Everything still pending is flushed synchronously when the app quits.
 *
 * Shutdown order: 'will-quit' flushes. 'quit' (also emitted by `app.exit()`, which skips
 * 'will-quit') flushes again and switches to shutdown mode, where a write queued from then on runs
 * at once instead of on a timer that could fire after surffish.db has been closed. The profile
 * database flushes this queue itself before it closes (store/index.ts), so the order holds whichever
 * 'quit' listener runs first.
 */
const pending = new Map<
  string,
  { timer: ReturnType<typeof setTimeout>; run: () => void }
>();
let quitHookInstalled = false;
let shuttingDown = false;

function runSafely(key: string, run: () => void): void {
  try {
    run();
  } catch (error) {
    console.error(`Deferred write "${key}" failed:`, error);
  }
}

export function deferWrite(key: string, run: () => void, delayMs = 800): void {
  installQuitHook();
  if (shuttingDown) {
    cancelDeferredWrite(key);
    runSafely(key, run);
    return;
  }
  const existing = pending.get(key);
  if (existing) {
    existing.run = run;
    return;
  }
  const entry = {
    run,
    timer: setTimeout(() => {
      pending.delete(key);
      runSafely(key, entry.run);
    }, delayMs),
  };
  pending.set(key, entry);
}

export function flushDeferredWrites(): void {
  for (const [key, entry] of [...pending]) {
    clearTimeout(entry.timer);
    pending.delete(key);
    runSafely(key, entry.run);
  }
}

/** Run one queued write now (a privacy action that must reach the disk before a crash or quit). */
export function flushDeferredWrite(key: string): void {
  const entry = pending.get(key);
  if (!entry) return;
  clearTimeout(entry.timer);
  pending.delete(key);
  runSafely(key, entry.run);
}

/** Flush everything and run later writes at once: the app is going away (see the header). */
export function beginShutdownWrites(): void {
  shuttingDown = true;
  flushDeferredWrites();
}

export function isShuttingDownWrites(): boolean {
  return shuttingDown;
}

/** Drop a queued write, e.g. when the data it would persist was just cleared. */
export function cancelDeferredWrite(key: string): void {
  const entry = pending.get(key);
  if (!entry) return;
  clearTimeout(entry.timer);
  pending.delete(key);
}

function installQuitHook(): void {
  if (quitHookInstalled) return;
  quitHookInstalled = true;
  try {
    app.on("will-quit", flushDeferredWrites);
    app.on("quit", beginShutdownWrites);
  } catch {
    // Unit tests import modules without a live Electron app.
  }
}
