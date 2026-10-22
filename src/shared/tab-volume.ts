/**
 * Per-tab volume (0–100%, no boost).
 *
 * Electron has no per-WebContents volume, so the page is turned down from inside: a frame preload
 * (preload/tab-volume-frame.cjs) runs in every frame of a tab and plays each media element at
 * `page volume × tab volume` (the page still reads and sets its own value) and puts a gain in front
 * of each AudioContext's destination. Main keeps the tab's level, sends it to every frame, and
 * remembers it per site (origin), like page zoom. Volume 0 is not mute: mute stays Chromium's own
 * per-tab flag.
 */

/** Levels kept per site at most (most recently changed last, the oldest drop off). */
export const MAX_SAVED_SITE_VOLUMES = 200;
/** Scroll wheel step on the speaker. */
export const TAB_VOLUME_WHEEL_STEP = 0.05;
/** ⌘K Volume Up / Volume Down step. */
export const TAB_VOLUME_COMMAND_STEP = 0.1;
export const DEFAULT_TAB_VOLUME = 1;

/** 0..1 rounded to whole percent; null for anything that isn't a number. */
export function normalizeTabVolume(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.round(Math.min(1, Math.max(0, value)) * 100) / 100;
}

export function isDefaultTabVolume(volume: number): boolean {
  return Math.abs(volume - DEFAULT_TAB_VOLUME) < 0.005;
}

/** `current` moved by `delta`, kept in 0..1. */
export function stepTabVolume(current: number, delta: number): number {
  return (
    normalizeTabVolume(
      (normalizeTabVolume(current) ?? DEFAULT_TAB_VOLUME) + delta,
    ) ?? DEFAULT_TAB_VOLUME
  );
}

/** What a media element actually plays at: the page's own volume times the tab's, kept in 0..1. */
export function effectiveMediaVolume(
  pageVolume: number,
  tabVolume: number,
): number {
  const page = Number.isFinite(pageVolume)
    ? Math.min(1, Math.max(0, pageVolume))
    : 1;
  const tab = Number.isFinite(tabVolume)
    ? Math.min(1, Math.max(0, tabVolume))
    : 1;
  return Math.min(1, Math.max(0, page * tab));
}

export type TabVolumeLevel = "muted" | "off" | "low" | "high";

/** Which speaker the icon draws. */
export function tabVolumeLevel(volume: number, muted: boolean): TabVolumeLevel {
  if (muted) return "muted";
  if (volume <= 0.005) return "off";
  return volume < 0.5 ? "low" : "high";
}

export function formatTabVolume(volume: number): string {
  return `${Math.round((normalizeTabVolume(volume) ?? 1) * 100)}%`;
}

/** A tab's volume and which site it belongs to (the level follows the tab within one origin). */
export interface TabVolumeState {
  volume: number;
  /** Origin `volume` was set for or loaded from; null before the tab's first site. */
  volumeOrigin: string | null;
}

/**
 * The tab's volume for a page at `origin`. Staying on the same site keeps the tab's own level;
 * moving to another site takes that site's saved level (100% when none). A page with no http(s)
 * origin (about:blank, file:, a local page) keeps whatever the tab had. Mutates `state`.
 */
export function resolveTabVolume(
  state: TabVolumeState,
  origin: string | null,
  savedFor: (origin: string) => number | undefined,
): number {
  if (origin && origin !== state.volumeOrigin) {
    state.volumeOrigin = origin;
    state.volume = normalizeTabVolume(savedFor(origin)) ?? DEFAULT_TAB_VOLUME;
  }
  return state.volume;
}

/**
 * The saved levels after `origin` was set to `volume`: most recently changed last, 100% not kept,
 * capped at MAX_SAVED_SITE_VOLUMES (oldest dropped).
 */
export function withSiteVolume(
  saved: Readonly<Record<string, number>>,
  origin: string,
  volume: number,
): Record<string, number> {
  const next = { ...saved };
  delete next[origin];
  if (!isDefaultTabVolume(volume)) next[origin] = volume;
  return Object.fromEntries(
    Object.entries(next).slice(-MAX_SAVED_SITE_VOLUMES),
  );
}

/** Saved per-site levels from disk: valid origins and levels only, 100% dropped. */
export function parseSiteVolumes(
  value: unknown,
  normalizeOrigin: (value: unknown) => string | null,
): Record<string, number> {
  const out: Record<string, number> = {};
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return out;
  for (const [key, level] of Object.entries(value).slice(
    -MAX_SAVED_SITE_VOLUMES,
  )) {
    const origin = normalizeOrigin(key);
    const volume = normalizeTabVolume(level);
    if (origin && volume !== null && !isDefaultTabVolume(volume))
      out[origin] = volume;
  }
  return out;
}
