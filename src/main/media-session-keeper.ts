import type { WebContents } from 'electron'
import { holdsMediaSession, mediaHoldRecheckMs, nextMediaActivity, NO_MEDIA_ACTIVITY, type MediaActivity, type MediaEvent } from '../shared/media-session-hold'

/**
 * Per-tab play/pause tracking so hibernation, the memory saver and auto-archive leave a tab with a
 * paused media session alone (see shared/media-session-hold.ts). Media keys and Now Playing stay
 * Chromium's own (HardwareMediaKeyHandling / MediaSessionService are on by default in Electron and
 * Surffish neither disables them nor registers media-key shortcuts); this only keeps the page that
 * owns the session from being torn down underneath it.
 */
const activity = new WeakMap<WebContents, MediaActivity>()

function record(contents: WebContents, event: MediaEvent): void {
  activity.set(contents, nextMediaActivity(activity.get(contents) ?? NO_MEDIA_ACTIVITY, event, Date.now()))
}

/** Start tracking a tab's page. Call once per tab WebContents. */
export function trackTabMediaSession(contents: WebContents): void {
  contents.on('media-started-playing', () => record(contents, 'started'))
  contents.on('media-paused', () => record(contents, 'paused'))
  contents.on('did-start-navigation', (_event, _url, isInPlace, isMainFrame) => {
    if (isMainFrame && !isInPlace) record(contents, 'reset')
  })
  contents.on('render-process-gone', () => record(contents, 'reset'))
}

/** True while the page plays media, is audible, or paused it within the hold window. */
export function tabHoldsMediaSession(contents: WebContents | null | undefined, now = Date.now()): boolean {
  if (!contents || contents.isDestroyed()) return false
  return contents.isCurrentlyAudible() || holdsMediaSession(activity.get(contents) ?? NO_MEDIA_ACTIVITY, now)
}

/** When a deferred sleep should look at this tab again. */
export function tabMediaHoldRecheckMs(contents: WebContents, now = Date.now()): number {
  return mediaHoldRecheckMs(activity.get(contents) ?? NO_MEDIA_ACTIVITY, now)
}
