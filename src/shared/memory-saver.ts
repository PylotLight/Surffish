/**
 * Memory saver: on top of the time-based hibernation (Settings → Tabs), discard the least
 * recently used background tabs while the system is short of memory or Surffish itself has
 * grown past a share of RAM. A discarded tab keeps its place, title and favicon and reloads its
 * last page when opened, exactly like a hibernated one.
 */

export interface MemorySaverSettings {
  enabled: boolean
  /**
   * Tabs of the same site share one renderer process (Chromium's --process-per-site). Read once at
   * launch, so a change applies after a restart. Different sites, cross-site iframes, private tabs
   * and Space partitions never share a process either way (site isolation and storage partitions).
   */
  shareSiteProcesses: boolean
}

export const DEFAULT_MEMORY_SAVER_SETTINGS: MemorySaverSettings = { enabled: true, shareSiteProcesses: true }

export function parseMemorySaverSettings(value: unknown): MemorySaverSettings {
  const record = typeof value === 'object' && value !== null ? value as Record<string, unknown> : {}
  return {
    enabled: typeof record.enabled === 'boolean' ? record.enabled : DEFAULT_MEMORY_SAVER_SETTINGS.enabled,
    shareSiteProcesses: typeof record.shareSiteProcesses === 'boolean' ? record.shareSiteProcesses : DEFAULT_MEMORY_SAVER_SETTINGS.shareSiteProcesses
  }
}

/** `SURFFISH_PROCESS_PER_SITE=0|1` (tests, benches, troubleshooting) overrides the saved setting. */
export function shouldShareSiteProcesses(settings: MemorySaverSettings, envValue: string | undefined): boolean {
  if (envValue === '0' || envValue === '1') return envValue === '1'
  return settings.shareSiteProcesses
}

/** How often main samples memory while the saver is on (ms). */
export const MEMORY_CHECK_INTERVAL_MS = 30_000
/** A background tab must have been off screen this long before memory pressure can discard it. */
export const MIN_BACKGROUND_MS = 5 * 60_000
/** At most this many tabs per check, so a squeeze frees memory gradually instead of in one sweep. */
export const MAX_DISCARDS_PER_CHECK = 2

export interface MemorySample {
  /** Physical RAM, MB. */
  totalMB: number
  /** Memory the OS can hand out without swapping (Linux MemAvailable, Windows available), MB; null when unknown. */
  availableMB: number | null
  /** macOS kernel memory pressure (kern.memorystatus_vm_pressure_level): 1 normal, 2 warning, 4 critical; null elsewhere. */
  macPressureLevel: number | null
  /** Every Surffish process's working set, MB. */
  surffishMB: number
}

export type MemoryPressureReason = 'system' | 'surffish'

/** Low when available memory is under 10 % of RAM (at least 512 MB, at most 2 GB). */
export function lowAvailableThresholdMB(totalMB: number): number {
  return Math.min(2048, Math.max(512, totalMB * 0.1))
}

/** Surffish over half of RAM counts as pressure even when the system copes. */
export function surffishThresholdMB(totalMB: number): number {
  return totalMB * 0.5
}

/** Why memory counts as tight right now, or null when it doesn't. */
export function memoryPressure(sample: MemorySample): MemoryPressureReason | null {
  if (sample.macPressureLevel !== null && sample.macPressureLevel >= 2) return 'system'
  if (sample.macPressureLevel === null && sample.availableMB !== null && sample.totalMB > 0 && sample.availableMB < lowAvailableThresholdMB(sample.totalMB)) return 'system'
  if (sample.totalMB > 0 && sample.surffishMB > surffishThresholdMB(sample.totalMB)) return 'surffish'
  return null
}

export interface DiscardCandidate {
  id: string
  /** Has a live renderer (sleeping tabs have nothing to free). */
  live: boolean
  /** Active tab or a pane of the split on screen. */
  onScreen: boolean
  audible: boolean
  pinned: boolean
  /** PDF editor with edits, extension pages: never discarded. */
  protected: boolean
  /** When the tab left the screen (ms epoch); null = on screen / unknown. */
  inactiveSince: number | null
}

/**
 * The tabs memory pressure may discard, least recently used first: live, off screen for at
 * least MIN_BACKGROUND_MS, not playing sound, not pinned, not protected. Unsaved form input is
 * checked separately (it needs the page) just before discarding.
 */
export function discardOrder(candidates: readonly DiscardCandidate[], now: number): DiscardCandidate[] {
  return candidates
    .filter((tab) => tab.live && !tab.onScreen && !tab.audible && !tab.pinned && !tab.protected
      && tab.inactiveSince !== null && now - tab.inactiveSince >= MIN_BACKGROUND_MS)
    .sort((a, b) => (a.inactiveSince ?? 0) - (b.inactiveSince ?? 0))
}

/**
 * Page script: true when the page holds text the user typed and hasn't submitted (inputs whose
 * value differs from their default, edited textareas, checked boxes changed, contenteditable
 * focus), so discarding would lose it.
 */
export const UNSAVED_FORM_PROBE = `(() => {
  try {
    for (const el of document.querySelectorAll('input, textarea, select')) {
      if (el.disabled || el.readOnly) continue
      const type = (el.type || '').toLowerCase()
      if (type === 'hidden' || type === 'submit' || type === 'button' || type === 'reset' || type === 'image' || type === 'file') continue
      if (el.tagName === 'SELECT') { for (const option of el.options) if (option.selected !== option.defaultSelected) return true; continue }
      if (type === 'checkbox' || type === 'radio') { if (el.checked !== el.defaultChecked) return true; continue }
      if (el.value !== el.defaultValue && el.value.trim() !== '') return true
    }
    const active = document.activeElement
    if (active && active.isContentEditable) return true
    return false
  } catch { return true }
})()`
