import { describe, expect, test } from 'bun:test'
import { AUDIBLE_RELEASE_MS, audibleReleaseInMs, isShownAudible, nextTabAudio, NO_TAB_AUDIO, tabAudioIndicator, type TabAudioActivity } from './tab-audio'

const now = 80_000_000
const audible = (state: TabAudioActivity, value: boolean, at = now): TabAudioActivity => nextTabAudio(state, { type: 'audible', audible: value }, at)

describe('tab audio state', () => {
  test('a page that never makes sound (muted autoplay video) shows nothing', () => {
    // media-started-playing fires for it, but Chromium never reports it audible.
    expect(isShownAudible(NO_TAB_AUDIO, now)).toBe(false)
    expect(tabAudioIndicator({ audible: false, muted: false, heard: NO_TAB_AUDIO.heard })).toBe('none')
    expect(audible(NO_TAB_AUDIO, false)).toBe(NO_TAB_AUDIO)
  })

  test('audible shows the playing speaker and marks the page heard', () => {
    const state = audible(NO_TAB_AUDIO, true)
    expect(state).toEqual({ audible: true, quietSince: null, heard: true })
    expect(isShownAudible(state, now + 60_000)).toBe(true)
    expect(audible(state, true)).toBe(state)
    expect(tabAudioIndicator({ audible: true, muted: false, heard: true })).toBe('playing')
  })

  test('going quiet holds the speaker briefly, then releases it', () => {
    const quiet = audible(audible(NO_TAB_AUDIO, true), false, now + 5000)
    expect(quiet).toEqual({ audible: false, quietSince: now + 5000, heard: true })
    expect(isShownAudible(quiet, now + 5000)).toBe(true)
    expect(isShownAudible(quiet, now + 5000 + AUDIBLE_RELEASE_MS - 1)).toBe(true)
    expect(isShownAudible(quiet, now + 5000 + AUDIBLE_RELEASE_MS)).toBe(false)
    expect(audibleReleaseInMs(quiet, now + 5200)).toBe(AUDIBLE_RELEASE_MS - 200)
    expect(audibleReleaseInMs(quiet, now + 5000 + AUDIBLE_RELEASE_MS)).toBeNull()
    expect(audibleReleaseInMs(audible(NO_TAB_AUDIO, true), now)).toBeNull()
    expect(audibleReleaseInMs(NO_TAB_AUDIO, now)).toBeNull()
    // A second "quiet" doesn't restart the hold.
    expect(audible(quiet, false, now + 9000)).toBe(quiet)
  })

  test('a brief gap (track change) stays playing and keeps no stale quietSince', () => {
    const quiet = audible(audible(NO_TAB_AUDIO, true), false, now)
    const again = audible(quiet, true, now + 300)
    expect(again).toEqual({ audible: true, quietSince: null, heard: true })
  })

  test('reset (navigation, crash) forgets everything', () => {
    const quiet = audible(audible(NO_TAB_AUDIO, true), false)
    expect(nextTabAudio(quiet, { type: 'reset' }, now)).toBe(NO_TAB_AUDIO)
  })
})

describe('tab audio indicator', () => {
  test('muted wins: the user muted the tab', () => {
    expect(tabAudioIndicator({ audible: true, muted: true })).toBe('muted')
    expect(tabAudioIndicator({ audible: false, muted: true })).toBe('muted')
  })

  test('quiet after being heard: idle (slider on hover, no speaker)', () => {
    expect(tabAudioIndicator({ audible: false, muted: false, heard: true })).toBe('idle')
  })

  test('a non-default volume keeps the slider reachable', () => {
    expect(tabAudioIndicator({ audible: false, muted: false, volume: 0.4 })).toBe('idle')
    expect(tabAudioIndicator({ audible: false, muted: false, volume: 0 })).toBe('idle')
    expect(tabAudioIndicator({ audible: false, muted: false, volume: 1 })).toBe('none')
    expect(tabAudioIndicator({ audible: false, muted: false, volume: 0.999 })).toBe('none')
  })
})
