/**
 * Memory saver: on top of the time-based hibernation (Settings → Tabs), discard the least
 * recently used background tabs while the system is short of memory or Surffish itself has
 * grown past a share of RAM. A discarded tab keeps its place, title and favicon and reloads its
 * last page when opened, exactly like a hibernated one.
 */

export interface MemorySaverSettings {
  enabled: boolean;
}

export const DEFAULT_MEMORY_SAVER_SETTINGS: MemorySaverSettings = {
  enabled: true,
};

export function parseMemorySaverSettings(value: unknown): MemorySaverSettings {
  const record =
    typeof value === "object" && value !== null
      ? (value as Record<string, unknown>)
      : {};
  return {
    enabled:
      typeof record.enabled === "boolean"
        ? record.enabled
        : DEFAULT_MEMORY_SAVER_SETTINGS.enabled,
  };
}

/** How often main samples memory while the saver is on (ms). */
export const MEMORY_CHECK_INTERVAL_MS = 30_000;
/**
 * Under critical pressure (macOS kernel level 4, or available memory under half the low mark) a
 * background tab must have been off screen this long before it can be discarded.
 */
export const MIN_BACKGROUND_MS = 5 * 60_000;
/**
 * Otherwise (warning-level pressure, Surffish over its share) the saver never discards a tab seen
 * more recently than this, nor sooner than the user's own sleep timer would (Settings → Tabs).
 */
export const SOFT_FLOOR_MS = 15 * 60_000;
/** "Never" sleep timer: the saver still waits an hour before discarding, short of critical pressure. */
export const NEVER_TIMER_FLOOR_MS = 60 * 60_000;
/** At most this many tabs per check, so a squeeze frees memory gradually instead of in one sweep. */
export const MAX_DISCARDS_PER_CHECK = 2;

export interface MemorySample {
  /** Physical RAM, MB. */
  totalMB: number;
  /** Memory the OS can hand out without swapping (Linux MemAvailable, Windows available), MB; null when unknown. */
  availableMB: number | null;
  /** macOS kernel memory pressure (kern.memorystatus_vm_pressure_level): 1 normal, 2 warning, 4 critical; null elsewhere. */
  macPressureLevel: number | null;
  /**
   * macOS kern.memorystatus_level: percent of RAM the kernel counts as available (free plus
   * reclaimable: inactive, purgeable, speculative, compressible), what `memory_pressure` prints as
   * "System-wide memory free percentage". Null when unknown / not macOS.
   */
  macAvailablePercent?: number | null;
  /** Every Surffish process's working set, MB. */
  surffishMB: number;
}

/** `critical` lets the saver go down to MIN_BACKGROUND_MS; the others respect the soft floor. */
export type MemoryPressureReason = "critical" | "system" | "surffish";

/** Low when available memory is under 10 % of RAM (at least 512 MB, at most 2 GB). */
export function lowAvailableThresholdMB(totalMB: number): number {
  return Math.min(2048, Math.max(512, totalMB * 0.1));
}

/** Surffish over half of RAM counts as pressure even when the system copes. */
export function surffishThresholdMB(totalMB: number): number {
  return totalMB * 0.5;
}

/**
 * Why memory counts as tight right now, or null when it doesn't.
 *
 * macOS keeps raw free pages near zero by design (file cache, compressor), and the kernel sits at
 * "warning" (level 2) for long stretches on a busy Mac while plenty is still reclaimable, so
 * warning alone is not enough: it counts only when the kernel's available percentage is also under
 * the low mark (or unknown). Level 4 (critical) always counts. Summed working sets double count
 * shared pages across Electron's processes on macOS, so the Surffish share only counts there while
 * the kernel reports pressure too.
 */
export function memoryPressure(
  sample: MemorySample,
): MemoryPressureReason | null {
  const low = sample.totalMB > 0 ? lowAvailableThresholdMB(sample.totalMB) : 0;
  if (sample.macPressureLevel !== null) {
    if (sample.macPressureLevel >= 4) return "critical";
    const percent = sample.macAvailablePercent ?? null;
    const availableMB =
      percent !== null && sample.totalMB > 0
        ? (sample.totalMB * percent) / 100
        : null;
    if (sample.macPressureLevel >= 2) {
      if (availableMB === null || availableMB < low) return "system";
      if (
        sample.totalMB > 0 &&
        sample.surffishMB > surffishThresholdMB(sample.totalMB)
      )
        return "surffish";
    }
    return null;
  }
  if (sample.availableMB !== null && sample.totalMB > 0) {
    if (sample.availableMB < low / 2) return "critical";
    if (sample.availableMB < low) return "system";
  }
  if (
    sample.totalMB > 0 &&
    sample.surffishMB > surffishThresholdMB(sample.totalMB)
  )
    return "surffish";
  return null;
}

/**
 * How long a background tab must have been off screen before the saver may discard it: 5 min under
 * critical pressure, else the longer of 15 min and the user's sleep timer (an hour when the timer
 * is off), so the saver never beats the timer the user chose unless memory is really short.
 */
export function discardFloorMs(
  reason: MemoryPressureReason,
  tabSleepMinutes: number,
): number {
  if (reason === "critical") return MIN_BACKGROUND_MS;
  const timerMs =
    tabSleepMinutes > 0 ? tabSleepMinutes * 60_000 : NEVER_TIMER_FLOOR_MS;
  return Math.max(SOFT_FLOOR_MS, timerMs);
}

export interface DiscardCandidate {
  id: string;
  /** Has a live renderer (sleeping tabs have nothing to free). */
  live: boolean;
  /** Active tab or a pane of the split on screen. */
  onScreen: boolean;
  audible: boolean;
  pinned: boolean;
  /** PDF editor with edits, extension pages: never discarded. */
  protected: boolean;
  /** When the tab left the screen (ms epoch); null = on screen / unknown. */
  inactiveSince: number | null;
}

/**
 * The tabs memory pressure may discard, least recently used first: live, off screen for at
 * least `minBackgroundMs` (MIN_BACKGROUND_MS by default; see discardFloorMs), not playing sound,
 * not pinned, not protected. Unsaved form input is checked separately (it needs the page) just
 * before discarding.
 */
export function discardOrder(
  candidates: readonly DiscardCandidate[],
  now: number,
  minBackgroundMs = MIN_BACKGROUND_MS,
): DiscardCandidate[] {
  return candidates
    .filter(
      (tab) =>
        tab.live &&
        !tab.onScreen &&
        !tab.audible &&
        !tab.pinned &&
        !tab.protected &&
        tab.inactiveSince !== null &&
        now - tab.inactiveSince >= minBackgroundMs,
    )
    .sort((a, b) => (a.inactiveSince ?? 0) - (b.inactiveSince ?? 0));
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
})()`;
