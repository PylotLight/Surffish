import { describe, expect, test } from 'bun:test'
import {
  adblockBadge,
  adblockButtonLabel,
  BlockedRequestTally,
  isBlockedResponse,
  MAX_TRACKED_HOSTS,
  OTHER_HOSTS,
  requestHost
} from './adblock-stats'

describe('adblock stats', () => {
  test('cancelled and redirected-to-stub requests count as blocked; allowed ones do not', () => {
    expect(isBlockedResponse({ cancel: true })).toBe(true)
    expect(isBlockedResponse({ redirectURL: 'data:text/javascript,' })).toBe(true)
    expect(isBlockedResponse({})).toBe(false)
    expect(isBlockedResponse({ cancel: false })).toBe(false)
    expect(isBlockedResponse({ redirectURL: '' })).toBe(false)
    expect(isBlockedResponse(null)).toBe(false)
  })

  test('request hosts drop www. and lower-case; junk is empty', () => {
    expect(requestHost('https://WWW.DoubleClick.net/ad.js')).toBe('doubleclick.net')
    expect(requestHost('https://referrer.disqus.com/juggler/event.js?x=1')).toBe('referrer.disqus.com')
    expect(requestHost('not a url')).toBe('')
  })

  test('tally counts by domain, most first, ties by name', () => {
    const tally = new BlockedRequestTally()
    tally.record('https://a.example/1')
    tally.record('https://b.example/1')
    tally.record('https://b.example/2')
    tally.record('https://c.example/1')
    expect(tally.total).toBe(4)
    expect(tally.top()).toEqual([
      { host: 'b.example', count: 2 },
      { host: 'a.example', count: 1 },
      { host: 'c.example', count: 1 }
    ])
    expect(tally.top(1)).toEqual([{ host: 'b.example', count: 2 }])
  })

  test('a page that trips hundreds of domains is capped; the rest go under "other"', () => {
    const tally = new BlockedRequestTally()
    for (let i = 0; i < MAX_TRACKED_HOSTS + 25; i += 1) tally.record(`https://h${i}.example/x`)
    tally.record('https://h0.example/again')
    expect(tally.total).toBe(MAX_TRACKED_HOSTS + 26)
    const all = tally.top(10_000)
    expect(all.length).toBe(MAX_TRACKED_HOSTS + 1)
    expect(all.find((entry) => entry.host === OTHER_HOSTS)?.count).toBe(25)
    expect(all.find((entry) => entry.host === 'h0.example')?.count).toBe(2)
  })

  test('badge and label', () => {
    expect(adblockBadge(0)).toBe('')
    expect(adblockBadge(-3)).toBe('')
    expect(adblockBadge(Number.NaN)).toBe('')
    expect(adblockBadge(7)).toBe('7')
    expect(adblockBadge(999)).toBe('999')
    expect(adblockBadge(1000)).toBe('999+')
    expect(adblockButtonLabel({ web: false, enabled: true, blocked: 0 })).toBe('Ad blocker')
    expect(adblockButtonLabel({ web: true, enabled: true, blocked: 1 })).toBe('Ad blocker: 1 request blocked on this page')
    expect(adblockButtonLabel({ web: true, enabled: true, blocked: 12 })).toBe('Ad blocker: 12 requests blocked on this page')
    expect(adblockButtonLabel({ web: true, enabled: false, blocked: 0, host: 'example.com' })).toBe('Ad blocker: off on example.com')
  })
})
