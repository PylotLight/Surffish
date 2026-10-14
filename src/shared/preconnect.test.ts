import { describe, expect, test } from 'bun:test'
import {
  Debouncer,
  HOVER_DWELL_MS,
  ORIGIN_COOLDOWN_MS,
  parsePreconnectSettings,
  preconnectOrigin,
  PreconnectLimiter,
  TYPING_DEBOUNCE_MS,
  typedInputQualifies,
  typedPreconnectUrl,
  type DebounceTimers
} from './preconnect'

/** Manual clock + timers so debounce timing is exact. */
function fakeTimers(): DebounceTimers & { advance: (ms: number) => void; pending: () => number } {
  let now = 0
  let nextId = 1
  const timers = new Map<number, { at: number; callback: () => void }>()
  return {
    set: (callback, ms) => {
      const id = nextId++
      timers.set(id, { at: now + ms, callback })
      return id
    },
    clear: (handle) => { timers.delete(handle as number) },
    advance: (ms) => {
      const end = now + ms
      for (;;) {
        const due = [...timers.entries()].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0]
        if (!due) break
        timers.delete(due[0])
        now = due[1].at
        due[1].callback()
      }
      now = end
    },
    pending: () => timers.size
  }
}

describe('preconnect settings', () => {
  test('on by default; a saved choice is kept', () => {
    expect(parsePreconnectSettings(undefined)).toEqual({ enabled: true })
    expect(parsePreconnectSettings({ enabled: false })).toEqual({ enabled: false })
    expect(parsePreconnectSettings({ enabled: 'nope' })).toEqual({ enabled: true })
  })
})

describe('preconnect origin', () => {
  test('http(s) only, origin only', () => {
    expect(preconnectOrigin('https://example.com/a/b?q=secret#x')).toBe('https://example.com')
    expect(preconnectOrigin('http://example.com:8080/x')).toBe('http://example.com:8080')
    expect(preconnectOrigin('https://www.google.com/search?q=my+secret+query')).toBe('https://www.google.com')
  })

  test('never for other schemes, credentials or junk', () => {
    for (const value of ['file:///etc/passwd', 'chrome-extension://abc/page.html', 'blob:https://a.com/1', 'data:text/html,hi', 'javascript:alert(1)', 'surffish://newtab', 'about:blank', 'https://user:pw@example.com/', 'not a url', '', null, undefined]) {
      expect(preconnectOrigin(value as string)).toBeNull()
    }
  })
})

describe('typed input', () => {
  const resolve = (text: string): string | null => text.includes('.') ? `https://${text}/` : `https://duckduckgo.com/?q=${encodeURIComponent(text)}`

  test('only after 2+ characters', () => {
    expect(typedInputQualifies('')).toBe(false)
    expect(typedInputQualifies(' g ')).toBe(false)
    expect(typedInputQualifies('gi')).toBe(true)
    expect(typedPreconnectUrl('g', 'https://github.com/', resolve)).toBeNull()
  })

  test('top suggestion wins, as its origin', () => {
    expect(typedPreconnectUrl('gith', 'https://github.com/PylotLight/Surffish', resolve)).toBe('https://github.com')
  })

  test('no suggestion: the typed URL, or only the search engine origin for a query', () => {
    expect(typedPreconnectUrl('example.org', null, resolve)).toBe('https://example.org')
    expect(typedPreconnectUrl('cats in hats', null, resolve)).toBe('https://duckduckgo.com')
    // A suggestion that isn't web (an old file: entry) falls back to the resolver.
    expect(typedPreconnectUrl('cats', 'file:///tmp/cats.html', resolve)).toBe('https://duckduckgo.com')
  })
})

describe('preconnect limiter', () => {
  test('once per origin per cooldown, per session', () => {
    let now = 1_000
    const limiter = new PreconnectLimiter(ORIGIN_COOLDOWN_MS, 256, () => now)
    expect(limiter.take('persist:surffish', 'https://a.com')).toBe(true)
    expect(limiter.take('persist:surffish', 'https://a.com')).toBe(false)
    // Another Space's partition has its own sockets, so its own cooldown.
    expect(limiter.take('persist:surffish-space-work', 'https://a.com')).toBe(true)
    expect(limiter.take('persist:surffish', 'https://b.com')).toBe(true)
    now += ORIGIN_COOLDOWN_MS - 1
    expect(limiter.take('persist:surffish', 'https://a.com')).toBe(false)
    now += 1
    expect(limiter.take('persist:surffish', 'https://a.com')).toBe(true)
  })

  test('search engine queries per keystroke reach the engine origin once', () => {
    const limiter = new PreconnectLimiter(ORIGIN_COOLDOWN_MS, 256, () => 0)
    const resolve = (text: string): string => `https://duckduckgo.com/?q=${encodeURIComponent(text)}`
    const sent = ['ca', 'cat', 'cats', 'cats i', 'cats in'].map((text) => typedPreconnectUrl(text, null, resolve)).filter((url): url is string => url !== null && limiter.take('p', url))
    expect(sent).toEqual(['https://duckduckgo.com'])
  })

  test('memory stays bounded', () => {
    const limiter = new PreconnectLimiter(ORIGIN_COOLDOWN_MS, 3, () => 0)
    for (const host of ['a', 'b', 'c', 'd', 'e']) limiter.take('p', `https://${host}.com`)
    expect(limiter.size).toBe(3)
    // The oldest were evicted, so they may go again.
    expect(limiter.take('p', 'https://a.com')).toBe(true)
    expect(limiter.take('p', 'https://e.com')).toBe(false)
  })
})

describe('debouncer', () => {
  test('typing: only the last value, once things go quiet for 150 ms', () => {
    const timers = fakeTimers()
    const delivered: string[] = []
    const debouncer = new Debouncer<string>(TYPING_DEBOUNCE_MS, (value) => delivered.push(value), timers)
    for (const text of ['gi', 'git', 'gith', 'githu']) {
      debouncer.push(text)
      timers.advance(100)
    }
    expect(delivered).toEqual([])
    timers.advance(TYPING_DEBOUNCE_MS - 100 - 1)
    expect(delivered).toEqual([])
    timers.advance(1)
    expect(delivered).toEqual(['githu'])
    expect(timers.pending()).toBe(0)
    expect(debouncer.waiting).toBe(false)
  })

  test('hover: a link passed over quickly never fires; a rested one does', () => {
    const timers = fakeTimers()
    const delivered: string[] = []
    const debouncer = new Debouncer<string>(HOVER_DWELL_MS, (value) => delivered.push(value), timers)
    debouncer.push('https://quick.example/')
    timers.advance(HOVER_DWELL_MS - 50)
    debouncer.push('https://rested.example/')
    timers.advance(HOVER_DWELL_MS)
    expect(delivered).toEqual(['https://rested.example/'])
  })

  test('cancel drops the pending value', () => {
    const timers = fakeTimers()
    const delivered: string[] = []
    const debouncer = new Debouncer<string>(TYPING_DEBOUNCE_MS, (value) => delivered.push(value), timers)
    debouncer.push('ab')
    debouncer.cancel()
    timers.advance(1_000)
    expect(delivered).toEqual([])
    expect(timers.pending()).toBe(0)
  })
})
