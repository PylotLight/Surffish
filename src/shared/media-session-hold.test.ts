import { describe, expect, test } from 'bun:test'
import { holdsMediaSession, mediaHoldRecheckMs, mediaHoldRemainingMs, nextMediaActivity, NO_MEDIA_ACTIVITY, PAUSED_MEDIA_HOLD_MS } from './media-session-hold'

const now = 50_000_000

describe('media session hold', () => {
  test('no media: nothing held', () => {
    expect(holdsMediaSession(NO_MEDIA_ACTIVITY, now)).toBe(false)
    expect(mediaHoldRemainingMs(NO_MEDIA_ACTIVITY, now)).toBe(0)
  })

  test('playing holds indefinitely; pausing holds for PAUSED_MEDIA_HOLD_MS', () => {
    const playing = nextMediaActivity(NO_MEDIA_ACTIVITY, 'started', now)
    expect(holdsMediaSession(playing, now + 10 * PAUSED_MEDIA_HOLD_MS)).toBe(true)
    const paused = nextMediaActivity(playing, 'paused', now)
    expect(paused).toEqual({ playing: false, pausedAt: now })
    // The case that dropped Now Playing: paused a moment ago, no longer audible.
    expect(holdsMediaSession(paused, now + 1_000)).toBe(true)
    expect(holdsMediaSession(paused, now + PAUSED_MEDIA_HOLD_MS - 1)).toBe(true)
    expect(holdsMediaSession(paused, now + PAUSED_MEDIA_HOLD_MS)).toBe(false)
  })

  test('resuming and pausing again restarts the hold', () => {
    let state = nextMediaActivity(NO_MEDIA_ACTIVITY, 'started', now)
    state = nextMediaActivity(state, 'paused', now)
    state = nextMediaActivity(state, 'started', now + 1_000)
    expect(holdsMediaSession(state, now + 2 * PAUSED_MEDIA_HOLD_MS)).toBe(true)
    state = nextMediaActivity(state, 'paused', now + 5_000)
    expect(mediaHoldRemainingMs(state, now + 5_000)).toBe(PAUSED_MEDIA_HOLD_MS)
  })

  test('a pause with no play before it holds nothing', () => {
    expect(nextMediaActivity(NO_MEDIA_ACTIVITY, 'paused', now)).toBe(NO_MEDIA_ACTIVITY)
  })

  test('a second player stopping keeps the latest pause time', () => {
    let state = nextMediaActivity(NO_MEDIA_ACTIVITY, 'started', now)
    state = nextMediaActivity(state, 'paused', now)
    state = nextMediaActivity(state, 'paused', now + 60_000)
    expect(state.pausedAt).toBe(now + 60_000)
  })

  test('a new document or a dead renderer clears the hold', () => {
    const paused = nextMediaActivity(nextMediaActivity(NO_MEDIA_ACTIVITY, 'started', now), 'paused', now)
    expect(holdsMediaSession(nextMediaActivity(paused, 'reset', now), now)).toBe(false)
    expect(holdsMediaSession(nextMediaActivity(nextMediaActivity(NO_MEDIA_ACTIVITY, 'started', now), 'reset', now), now)).toBe(false)
  })

  test('sleep recheck: when the hold runs out, at least a minute, a minute while playing', () => {
    const playing = nextMediaActivity(NO_MEDIA_ACTIVITY, 'started', now)
    expect(mediaHoldRecheckMs(playing, now)).toBe(60_000)
    const paused = nextMediaActivity(playing, 'paused', now)
    expect(mediaHoldRecheckMs(paused, now)).toBe(PAUSED_MEDIA_HOLD_MS)
    expect(mediaHoldRecheckMs(paused, now + PAUSED_MEDIA_HOLD_MS - 5)).toBe(60_000)
  })
})
