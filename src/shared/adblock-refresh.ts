/**
 * Timing for refreshing the ad-filter lists. uBO's quick-fixes list (where the
 * YouTube fixes land) expires every 8 hours, so a cached engine should be
 * re-downloaded as it reaches that age, not on a wall-clock interval measured
 * from launch. Nothing here imports Electron.
 */

/**
 * Delay until the first list refresh after a cached engine loads.
 * `null` means "start with the plain interval": no cache (the first run already
 * refreshes) or a cache already past the interval (initialize() refreshes now,
 * re-baselining the clock). Otherwise the tick lands exactly at the interval.
 */
export function firstRefreshDelayMs(
  cacheAgeMs: number | null,
  intervalMs: number,
): number | null {
  if (cacheAgeMs === null || cacheAgeMs >= intervalMs) return null;
  return intervalMs - cacheAgeMs;
}
