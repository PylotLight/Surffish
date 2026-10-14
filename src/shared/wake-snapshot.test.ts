import { describe, expect, test } from 'bun:test'
import {
  isWakeSnapshotPassthroughTarget,
  nextWakeSnapshotPhase,
  parseWakeSnapshotInput,
  pointInRect,
  WAKE_SNAPSHOT_MAX_TOTAL_BYTES,
  WAKE_SNAPSHOT_MAX_WIDTH,
  WakeSnapshotStore,
  wakeSnapshotFits,
  wakeSnapshotMatchesUrl,
  wakeSnapshotWidth
} from './wake-snapshot'

const entry = (bytes: number, isPrivate = false): { bytes: number; isPrivate: boolean } => ({ bytes, isPrivate })

describe('wake snapshot store', () => {
  test('total size is capped, least recently stored go first', () => {
    const store = new WakeSnapshotStore<ReturnType<typeof entry>>(1_000, 600)
    expect(store.set('a', entry(400))).toBe(true)
    expect(store.set('b', entry(400))).toBe(true)
    expect(store.set('c', entry(400))).toBe(true)
    expect(store.has('a')).toBe(false)
    expect(store.totalBytes).toBe(800)
    // Re-storing a tab refreshes it (it is now the newest).
    store.set('b', entry(300))
    store.set('d', entry(500))
    expect(store.has('c')).toBe(false)
    expect([store.has('b'), store.has('d')]).toEqual([true, true])
    expect(store.totalBytes).toBe(800)
  })

  test('a snapshot over the per-snapshot cap is never kept (and replaces nothing)', () => {
    const store = new WakeSnapshotStore<ReturnType<typeof entry>>(1_000, 600)
    store.set('a', entry(100))
    expect(store.set('a', entry(700))).toBe(false)
    expect(store.has('a')).toBe(false)
    expect(store.set('b', entry(0))).toBe(false)
    expect(store.totalBytes).toBe(0)
  })

  test('shown once: take removes it; close and private end drop them', () => {
    const store = new WakeSnapshotStore<ReturnType<typeof entry>>()
    store.set('a', entry(10))
    store.set('p1', entry(10, true))
    store.set('p2', entry(10, true))
    expect(store.take('a')?.bytes).toBe(10)
    expect(store.take('a')).toBeUndefined()
    expect(store.deleteWhere((value) => value.isPrivate)).toBe(2)
    expect(store.size).toBe(0)
    expect(store.totalBytes).toBe(0)
  })

  test('defaults are memory-bounded', () => {
    expect(WAKE_SNAPSHOT_MAX_TOTAL_BYTES).toBeLessThanOrEqual(32 * 1024 * 1024)
    expect(wakeSnapshotWidth(2880)).toBe(WAKE_SNAPSHOT_MAX_WIDTH)
    expect(wakeSnapshotWidth(800)).toBe(800)
    expect(wakeSnapshotWidth(0)).toBe(0)
  })
})

describe('wake snapshot fit', () => {
  test('same page, fragments aside', () => {
    expect(wakeSnapshotMatchesUrl('https://a.com/x?y=1#top', 'https://a.com/x?y=1')).toBe(true)
    expect(wakeSnapshotMatchesUrl('https://a.com/x', 'https://a.com/y')).toBe(false)
    expect(wakeSnapshotMatchesUrl('garbage', 'garbage')).toBe(false)
  })

  test('only when the page area is about the same size', () => {
    expect(wakeSnapshotFits({ width: 1200, height: 800 }, { width: 1200, height: 800 })).toBe(true)
    expect(wakeSnapshotFits({ width: 1200, height: 800 }, { width: 1100, height: 760 })).toBe(true)
    expect(wakeSnapshotFits({ width: 1200, height: 800 }, { width: 600, height: 800 })).toBe(false)
    expect(wakeSnapshotFits({ width: 0, height: 800 }, { width: 1200, height: 800 })).toBe(false)
  })
})

describe('wake snapshot lifecycle', () => {
  test('paint, load or timeout fade it; the fade then removes it', () => {
    for (const event of ['painted', 'loaded', 'timeout'] as const) {
      expect(nextWakeSnapshotPhase('showing', event)).toBe('fading')
    }
    expect(nextWakeSnapshotPhase('fading', 'faded')).toBe('gone')
    expect(nextWakeSnapshotPhase('fading', 'painted')).toBe('gone')
  })

  test('input, failure or leaving remove it at once', () => {
    for (const event of ['input', 'failed', 'left'] as const) {
      expect(nextWakeSnapshotPhase('showing', event)).toBe('gone')
      expect(nextWakeSnapshotPhase('fading', event)).toBe('gone')
    }
  })

  test('reduced motion skips the fade; gone stays gone', () => {
    expect(nextWakeSnapshotPhase('showing', 'painted', true)).toBe('gone')
    expect(nextWakeSnapshotPhase('gone', 'painted')).toBe('gone')
    expect(nextWakeSnapshotPhase('showing', 'faded')).toBe('showing')
  })
})

describe('wake snapshot input', () => {
  const element = (tagName: string, classes: string[] = [], id = ''): { tagName: string; id: string; classList: { contains: (name: string) => boolean } } =>
    ({ tagName, id, classList: { contains: (name: string) => classes.includes(name) } })

  test('presses on the transparent shell layers go to the page; toolbar UI keeps its own', () => {
    expect(isWakeSnapshotPassthroughTarget(element('BODY'))).toBe(true)
    expect(isWakeSnapshotPassthroughTarget(element('div', [], 'root'))).toBe(true)
    expect(isWakeSnapshotPassthroughTarget(element('div', ['browser-main']))).toBe(true)
    expect(isWakeSnapshotPassthroughTarget(element('img', ['wake-snapshot']))).toBe(true)
    expect(isWakeSnapshotPassthroughTarget(null)).toBe(true)
    expect(isWakeSnapshotPassthroughTarget(element('button', ['toolbar-button']))).toBe(false)
    expect(isWakeSnapshotPassthroughTarget(element('li', ['address-suggestion']))).toBe(false)
  })

  test('point in rect', () => {
    const rect = { x: 10, y: 50, width: 100, height: 100 }
    expect(pointInRect(10, 50, rect)).toBe(true)
    expect(pointInRect(109, 149, rect)).toBe(true)
    expect(pointInRect(110, 60, rect)).toBe(false)
    expect(pointInRect(20, 49, rect)).toBe(false)
  })

  test('IPC input is validated', () => {
    expect(parseWakeSnapshotInput({ kind: 'mouseDown', x: 5, y: 6, button: 'left', clickCount: 9, modifiers: ['shift', 'evil'] }))
      .toEqual({ kind: 'mouseDown', x: 5, y: 6, button: 'left', clickCount: 3, modifiers: ['shift'] })
    expect(parseWakeSnapshotInput({ kind: 'mouseWheel', x: 1, y: 2, deltaX: 0, deltaY: 40 })).toEqual({ kind: 'mouseWheel', x: 1, y: 2, deltaX: 0, deltaY: 40, modifiers: [] })
    expect(parseWakeSnapshotInput({ kind: 'key' })).toEqual({ kind: 'key' })
    expect(parseWakeSnapshotInput({ kind: 'mouseDown', x: 'a', y: 1 })).toBeNull()
    expect(parseWakeSnapshotInput({ kind: 'keyDown', x: 1, y: 1 })).toBeNull()
    expect(parseWakeSnapshotInput(null)).toBeNull()
  })
})
