/** Crashed / hung tab bookkeeping. Pure so the retry cap is unit-testable. */

/** Auto-reloads allowed inside the window before we stop and leave the crash screen up. */
export const MAX_AUTO_RELOADS = 2
export const CRASH_LOOP_WINDOW_MS = 60_000

export interface TabCrashRecord {
  /** Times of recent crashes (pruned to the loop window). */
  crashes: number[]
  /** Times we reloaded the tab on our own after a crash. */
  autoReloads: number[]
}

export function emptyCrashRecord(): TabCrashRecord {
  return { crashes: [], autoReloads: [] }
}

function recent(times: readonly number[], now: number): number[] {
  return times.filter((time) => now - time < CRASH_LOOP_WINDOW_MS && time <= now)
}

export function recordCrash(record: TabCrashRecord, now: number): TabCrashRecord {
  return { crashes: [...recent(record.crashes, now), now], autoReloads: recent(record.autoReloads, now) }
}

export function recordAutoReload(record: TabCrashRecord, now: number): TabCrashRecord {
  return { crashes: recent(record.crashes, now), autoReloads: [...recent(record.autoReloads, now), now] }
}

/** A page that crashes on load would loop forever; stop after a couple of tries per minute. */
export function canAutoReload(record: TabCrashRecord, now: number): boolean {
  return recent(record.autoReloads, now).length < MAX_AUTO_RELOADS
}

const REASONS: Record<string, string> = {
  'crashed': 'the page crashed',
  'oom': 'it ran out of memory',
  'killed': 'the page process was stopped',
  'abnormal-exit': 'the page process exited unexpectedly',
  'launch-failed': 'the page process could not start',
  'integrity-failure': 'a code integrity check failed',
  'memory-eviction': 'the system reclaimed its memory',
  'clean-exit': 'the page process exited'
}

export function crashReasonLabel(reason: string): string {
  return REASONS[reason] ?? 'the page process stopped'
}
