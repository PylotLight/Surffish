/**
 * Media session hold: keep a tab that holds a paused media session alive.
 *
 * macOS Now Playing (and the media keys) talk to Chromium's MediaSession for the page. A paused
 * player keeps that session, so play/pause from the keyboard or Control Center resumes it, but
 * only while the page's renderer exists. Hibernation (Settings → Tabs), the memory saver and
 * auto-archive used to look at `isCurrentlyAudible()` alone, which turns false a moment after
 * the user pauses; the next check then closed the tab's view and the session vanished from Now
 * Playing. This tracks play/pause per tab so those paths can leave a paused session alone.
 *
 * Main feeds it Electron's `media-started-playing` / `media-paused` events (`media-paused` also
 * fires when a player ends or goes away), `audio-state-changed` and cross-document navigations.
 *
 * Only a session that was actually *heard* is kept. Chromium fires `media-started-playing` for
 * muted autoplay video too (X, Instagram and news timelines), and that used to keep those tabs
 * awake for six hours after the last clip, with nothing in Now Playing worth keeping. The hold now
 * needs the page to have been audible (`audio-state-changed` / `isCurrentlyAudible()`, which
 * measures real output, so muted or volume-0 elements never count) since its document loaded. A
 * player that just started gets a short grace (MEDIA_START_GRACE_MS) to become audible, so a
 * background tab that starts music isn't put to sleep in the gap before Chromium reports it.
 */

/** How long a paused (or ended) media session keeps its tab from sleeping / being discarded. */
export const PAUSED_MEDIA_HOLD_MS = 6 * 60 * 60 * 1000;

/** How long a player that just started (and hasn't been heard yet) keeps its tab, waiting for audio. */
export const MEDIA_START_GRACE_MS = 10_000;

export interface MediaActivity {
  /** A player started and hasn't paused / ended since. */
  playing: boolean;
  /** Last time a player paused, ended or went away (ms epoch); null = never since load. */
  pausedAt: number | null;
  /** Last time a player started (ms epoch); null = never since load. */
  startedAt: number | null;
  /** The page has been audible since its document loaded (muted autoplay never sets this). */
  heard: boolean;
}

export type MediaEvent = "started" | "paused" | "audible" | "reset";

export const NO_MEDIA_ACTIVITY: MediaActivity = Object.freeze({
  playing: false,
  pausedAt: null,
  startedAt: null,
  heard: false,
});

export function nextMediaActivity(
  state: MediaActivity,
  event: MediaEvent,
  now: number,
): MediaActivity {
  switch (event) {
    case "started":
      return { ...state, playing: true, startedAt: now };
    case "paused":
      // A pause without a play since the page loaded is a player that never ran: nothing to keep.
      return state.playing || state.pausedAt !== null
        ? { ...state, playing: false, pausedAt: now }
        : state;
    case "audible":
      return state.heard ? state : { ...state, heard: true };
    case "reset":
      // A new document (or a dead renderer) has no session left to keep.
      return NO_MEDIA_ACTIVITY;
  }
}

/** How much longer the tab should be kept alive for its media session: Infinity while playing, 0 for none. */
export function mediaHoldRemainingMs(
  state: MediaActivity,
  now: number,
  holdMs = PAUSED_MEDIA_HOLD_MS,
  graceMs = MEDIA_START_GRACE_MS,
): number {
  if (!state.heard) {
    // Never audible (muted autoplay): only a just-started player's grace, while it is still playing.
    if (!state.playing || state.startedAt === null) return 0;
    return Math.max(0, state.startedAt + graceMs - now);
  }
  if (state.playing) return Number.POSITIVE_INFINITY;
  if (state.pausedAt === null) return 0;
  return Math.max(0, state.pausedAt + holdMs - now);
}

export function holdsMediaSession(
  state: MediaActivity,
  now: number,
  holdMs = PAUSED_MEDIA_HOLD_MS,
): boolean {
  return mediaHoldRemainingMs(state, now, holdMs) > 0;
}

/**
 * When a sleep timer that found the tab holding media should look again: when the hold runs out
 * (a playing tab: the old one-minute recheck), never sooner than a minute.
 */
export function mediaHoldRecheckMs(
  state: MediaActivity,
  now: number,
  holdMs = PAUSED_MEDIA_HOLD_MS,
): number {
  const remaining = mediaHoldRemainingMs(state, now, holdMs);
  return Number.isFinite(remaining) ? Math.max(60_000, remaining) : 60_000;
}
