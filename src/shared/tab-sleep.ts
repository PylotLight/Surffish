import type { BrowserTabSleep } from './types'

/**
 * Why a tab is asleep, for the moon's tooltip in the sidebar:
 * - `restored`: not loaded since Surffish started (session restore, reopened from the archive);
 * - `idle`: the timed sleep (Settings → Tabs) after `minutes` in the background;
 * - `memory`: the memory saver discarded it while memory was tight;
 * - `manual`: Hibernate/Suspend Tab, Hibernate Other Tabs, Task Manager;
 * - `crashed`: its page process went away while it was in the background.
 */
export function describeTabSleep(sleep: BrowserTabSleep | undefined): string {
  switch (sleep?.reason) {
    case 'idle': return sleep.minutes ? `Slept after ${formatSleepMinutes(sleep.minutes)} in the background` : 'Slept after being in the background'
    case 'memory': return 'Put to sleep early by memory saver (memory was low)'
    case 'manual': return 'Hibernated by you'
    case 'crashed': return 'Page process ended in the background'
    case 'restored':
    default: return 'Not loaded since Surffish started'
  }
}

function formatSleepMinutes(minutes: number): string {
  return minutes % 60 === 0 ? `${minutes / 60} h` : `${minutes} min`
}

/** Restored tabs never woke up this run: shown fainter than tabs Surffish put to sleep. */
export function isRestoredSleep(sleep: BrowserTabSleep | undefined): boolean {
  return !sleep || sleep.reason === 'restored'
}
