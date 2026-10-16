/**
 * The tab's speaker: what the sidebar row, the mini window header / strip chips and the popout strip
 * show for a tab's sound.
 *
 * It used to show whenever the page had *played media* (`media-started-playing`, plus the six hour
 * paused-session hold from media-session-hold.ts). Chromium fires that for muted autoplay video too
 * (X, Instagram, news sites play their timeline videos muted), so those tabs wore a green speaker
 * while nothing was audible, and kept it for hours after the video paused. The speaker now follows
 * Chromium's audible state (`audio-state-changed` / `isCurrentlyAudible()`, which measures the
 * actual output, so muted or volume-0 elements never count):
 *
 * - `playing`: audible now, or went quiet less than AUDIBLE_RELEASE_MS ago (a short hold so a track
 *   change or a rebuffer doesn't flicker the icon; Chromium's own hold is only ~0.3 s).
 * - `muted`: the user muted the tab (Electron's `setAudioMuted`; pages can't set it).
 * - `idle`: quiet, but the page has been audible since it loaded or the tab has a non-default
 *   volume. Nothing is drawn until the row (or chip) is hovered, so the volume slider stays
 *   reachable without an active speaker.
 * - `none`: nothing to show.
 *
 * `heard` resets with the document (cross-document navigation, a renderer crash) and, since state is
 * kept per WebContents, whenever a tab is hibernated / discarded and woken with a new one.
 */

/** How long the speaker keeps showing after the page goes quiet. */
export const AUDIBLE_RELEASE_MS = 1000

export interface TabAudioActivity {
  /** Chromium reports the page audible. */
  audible: boolean
  /** When it last went from audible to quiet (ms epoch); null while audible or never heard. */
  quietSince: number | null
  /** The page has been audible since its document loaded. */
  heard: boolean
}

export type TabAudioEvent = { type: 'audible'; audible: boolean } | { type: 'reset' }

export const NO_TAB_AUDIO: TabAudioActivity = Object.freeze({ audible: false, quietSince: null, heard: false })

export function nextTabAudio(state: TabAudioActivity, event: TabAudioEvent, now: number): TabAudioActivity {
  if (event.type === 'reset') return NO_TAB_AUDIO
  if (event.audible) return state.audible ? state : { audible: true, quietSince: null, heard: true }
  return state.audible ? { audible: false, quietSince: now, heard: state.heard } : state
}

/** Audible, or quiet for less than the release hold. */
export function isShownAudible(state: TabAudioActivity, now: number, releaseMs = AUDIBLE_RELEASE_MS): boolean {
  if (state.audible) return true
  return state.quietSince !== null && now - state.quietSince < releaseMs
}

/** When the release hold of a just-quiet tab ends (ms from now), or null when nothing is pending. */
export function audibleReleaseInMs(state: TabAudioActivity, now: number, releaseMs = AUDIBLE_RELEASE_MS): number | null {
  if (state.audible || state.quietSince === null) return null
  const left = state.quietSince + releaseMs - now
  return left > 0 ? left : null
}

export type TabAudioIndicator = 'playing' | 'muted' | 'idle' | 'none'

export interface TabAudioInput {
  /** Held audible (isShownAudible). */
  audible: boolean
  /** The user muted the tab. */
  muted: boolean
  /** The page has been audible since it loaded. */
  heard?: boolean
  /** Tab volume 0..1; anything but 1 keeps the slider reachable. */
  volume?: number
}

export function tabAudioIndicator({ audible, muted, heard = false, volume = 1 }: TabAudioInput): TabAudioIndicator {
  if (muted) return 'muted'
  if (audible) return 'playing'
  if (heard || Math.abs(volume - 1) >= 0.005) return 'idle'
  return 'none'
}
