import { describe, expect, test } from 'bun:test'
import { holdsMediaSession, MEDIA_START_GRACE_MS, mediaHoldRecheckMs, mediaHoldRemainingMs, nextMediaActivity, NO_MEDIA_ACTIVITY, PAUSED_MEDIA_HOLD_MS, type MediaActivity, type MediaEvent } from './media-session-hold'

const now = 50_000_000

/** Apply events in order, all at `at`. */
const apply = (events: MediaEvent[], at = now, from: MediaActivity = NO_MEDIA_ACTIVITY): MediaActivity =>
  events.reduce((state, event) => nextMediaActivity(state, event, at), from)
/** A player that started and was heard (real audio). */
const heardPlaying = (at = now) => apply(['started', 'audible'], at)

describe('media session hold', () => {
  test('no media: nothing held', () => {
    expect(holdsMediaSession(NO_MEDIA_ACTIVITY, now)).toBe(false)
    expect(mediaHoldRemainingMs(NO_MEDIA_ACTIVITY, now)).toBe(0)
  })

  test('playing holds indefinitely; pausing holds for PAUSED_MEDIA_HOLD_MS', () => {
    const playing = heardPlaying()
    expect(holdsMediaSession(playing, now + 10 * PAUSED_MEDIA_HOLD_MS)).toBe(true)
    const paused = nextMediaActivity(playing, 'paused', now)
    expect(paused).toEqual({ playing: false, pausedAt: now, startedAt: now, heard: true })
    // The case that dropped Now Playing: paused a moment ago, no longer audible.
    expect(holdsMediaSession(paused, now + 1_000)).toBe(true)
    expect(holdsMediaSession(paused, now + PAUSED_MEDIA_HOLD_MS - 1)).toBe(true)
    expect(holdsMediaSession(paused, now + PAUSED_MEDIA_HOLD_MS)).toBe(false)
  })

  test('resuming and pausing again restarts the hold', () => {
    let state = heardPlaying()
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
    let state = heardPlaying()
    state = nextMediaActivity(state, 'paused', now)
    state = nextMediaActivity(state, 'paused', now + 60_000)
    expect(state.pausedAt).toBe(now + 60_000)
  })

  test('a new document or a dead renderer clears the hold', () => {
    const paused = nextMediaActivity(heardPlaying(), 'paused', now)
    expect(holdsMediaSession(nextMediaActivity(paused, 'reset', now), now)).toBe(false)
    // The reset forgets that it was heard: muted autoplay on the next page holds nothing.
    expect(apply(['reset', 'started'], now, paused).heard).toBe(false)
    expect(holdsMediaSession(nextMediaActivity(heardPlaying(), 'reset', now), now)).toBe(false)
  })

  test('sleep recheck: when the hold runs out, at least a minute, a minute while playing', () => {
    const playing = heardPlaying()
    expect(mediaHoldRecheckMs(playing, now)).toBe(60_000)
    const paused = nextMediaActivity(playing, 'paused', now)
    expect(mediaHoldRecheckMs(paused, now)).toBe(PAUSED_MEDIA_HOLD_MS)
    expect(mediaHoldRecheckMs(paused, now + PAUSED_MEDIA_HOLD_MS - 5)).toBe(60_000)
  })

  test('muted autoplay (never audible) holds nothing past the start grace', () => {
    const muted = nextMediaActivity(NO_MEDIA_ACTIVITY, 'started', now)
    expect(muted.heard).toBe(false)
    // A short grace so a background tab that starts music isn't slept before Chromium reports audio.
    expect(holdsMediaSession(muted, now + MEDIA_START_GRACE_MS - 1)).toBe(true)
    expect(holdsMediaSession(muted, now + MEDIA_START_GRACE_MS)).toBe(false)
    expect(holdsMediaSession(muted, now + PAUSED_MEDIA_HOLD_MS)).toBe(false)
    expect(mediaHoldRecheckMs(muted, now)).toBe(60_000)
  })

  test('muted autoplay that pauses (the next timeline clip) holds nothing', () => {
    let state = nextMediaActivity(NO_MEDIA_ACTIVITY, 'started', now)
    state = nextMediaActivity(state, 'paused', now + 5_000)
    expect(holdsMediaSession(state, now + 5_001)).toBe(false)
    state = nextMediaActivity(state, 'started', now + 6_000)
    state = nextMediaActivity(state, 'paused', now + 9_000)
    expect(mediaHoldRemainingMs(state, now + 9_000)).toBe(0)
  })

  test('muted autoplay later unmuted: heard, so held like any player', () => {
    let state = nextMediaActivity(NO_MEDIA_ACTIVITY, 'started', now)
    state = nextMediaActivity(state, 'audible', now + 60_000)
    expect(holdsMediaSession(state, now + 10 * PAUSED_MEDIA_HOLD_MS)).toBe(true)
    state = nextMediaActivity(state, 'paused', now + 120_000)
    expect(mediaHoldRemainingMs(state, now + 120_000)).toBe(PAUSED_MEDIA_HOLD_MS)
  })

  test('audible then paused (music, podcast) keeps the full paused hold', () => {
    const paused = nextMediaActivity(heardPlaying(), 'paused', now + 1_000)
    expect(holdsMediaSession(paused, now + 1_000 + PAUSED_MEDIA_HOLD_MS - 1)).toBe(true)
    expect(holdsMediaSession(paused, now + 1_000 + PAUSED_MEDIA_HOLD_MS)).toBe(false)
  })

  test('audible without a player (Web Audio only) adds no media hold', () => {
    const state = nextMediaActivity(NO_MEDIA_ACTIVITY, 'audible', now)
    expect(state.heard).toBe(true)
    expect(holdsMediaSession(state, now)).toBe(false)
  })

  test("'audible' is idempotent", () => {
    const heard = heardPlaying()
    expect(nextMediaActivity(heard, 'audible', now + 1)).toBe(heard)
  })
})
