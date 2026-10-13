import { describe, expect, test } from 'bun:test'
import type { BrowserTabSummary } from './types'
import { applyTabPatch, createBroadcastQueue, diffTabs, resolveTabs, type TabSyncState } from './tab-broadcast'

const tab = (id: string, extra: Partial<BrowserTabSummary> = {}): BrowserTabSummary => ({
  id, url: `https://${id}.test/`, title: id, faviconUrl: null, loading: false, active: false, pinned: false,
  sleeping: false, audible: false, muted: false, private: false, ...extra
})
const icons = new Map([['sf-icon:1', 'data:image/png;base64,AAAA'], ['sf-icon:2', 'data:image/png;base64,BBBB']])
const iconData = (ref: string): string | undefined => icons.get(ref)

/** Send `lists` in turn, like main does to one surface, and apply each patch like its preload does. */
function roundTrip(lists: BrowserTabSummary[][]): { sent: ReturnType<typeof diffTabs>['patch'][]; received: TabSyncState | null } {
  let sender: TabSyncState | null = null
  let receiver: TabSyncState | null = null
  const sent = []
  for (const list of lists) {
    const { patch, state } = diffTabs(sender, list, iconData)
    sender = state
    sent.push(patch)
    if (patch) receiver = applyTabPatch(receiver, patch)
  }
  return { sent, received: receiver }
}

describe('tab broadcast diffs', () => {
  test('first send is a full list; the receiver rebuilds it with favicons resolved', () => {
    const list = [tab('a', { faviconUrl: 'sf-icon:1', active: true }), tab('b', { faviconUrl: 'https://b.test/favicon.ico' })]
    const { sent, received } = roundTrip([list])
    expect(sent[0]?.base).toBeNull()
    expect(sent[0]?.order).toEqual(['a', 'b'])
    expect(sent[0]?.icons).toEqual({ 'sf-icon:1': 'data:image/png;base64,AAAA' })
    expect(resolveTabs(received!)).toEqual([{ ...list[0]!, faviconUrl: 'data:image/png;base64,AAAA' }, list[1]!])
  })

  test('only changed fields travel, and an unchanged list sends nothing', () => {
    const one = [tab('a', { faviconUrl: 'sf-icon:1' }), tab('b')]
    const two = [tab('a', { faviconUrl: 'sf-icon:1', loading: true }), tab('b')]
    const { sent, received } = roundTrip([one, two, two])
    expect(sent[1]).toEqual({ seq: 2, base: 1, set: [{ id: 'a', loading: true }] })
    expect(sent[2]).toBeNull()
    expect(received?.tabs[0]?.loading).toBe(true)
  })

  test('a favicon is sent once even when many tabs share it', () => {
    const lists = [[tab('a', { faviconUrl: 'sf-icon:1' })], [tab('a', { faviconUrl: 'sf-icon:1' }), tab('b', { faviconUrl: 'sf-icon:1' })]]
    const { sent, received } = roundTrip(lists)
    expect(sent[1]?.icons).toBeUndefined()
    expect(resolveTabs(received!).map((t) => t.faviconUrl)).toEqual(['data:image/png;base64,AAAA', 'data:image/png;base64,AAAA'])
  })

  test('a favicon dropped by every tab and used again is resent', () => {
    const { sent, received } = roundTrip([[tab('a', { faviconUrl: 'sf-icon:1' })], [tab('a')], [tab('a', { faviconUrl: 'sf-icon:1' })]])
    expect(sent[2]?.icons).toEqual({ 'sf-icon:1': 'data:image/png;base64,AAAA' })
    expect(resolveTabs(received!)[0]?.faviconUrl).toBe('data:image/png;base64,AAAA')
  })

  test('reorder, close, and optional fields going away', () => {
    const split = { id: 's1', index: 0, count: 2, sizes: [0.5, 0.5] } as unknown as BrowserTabSummary['split']
    const one = [tab('a', { split }), tab('b'), tab('c')]
    const two = [tab('c'), tab('a')]
    const { sent, received } = roundTrip([one, two])
    expect(sent[1]?.order).toEqual(['c', 'a'])
    expect(sent[1]?.unset).toEqual([['a', ['split']]])
    expect(received?.tabs).toEqual(two)
  })

  test('a patch on a base the receiver lacks is refused (receiver resyncs)', () => {
    const first = diffTabs(null, [tab('a')], iconData)
    const second = diffTabs(first.state, [tab('a', { title: 'x' })], iconData)
    expect(applyTabPatch(null, second.patch!)).toBeNull()
    const wrong = applyTabPatch({ seq: 7, tabs: [tab('a')], icons: new Map() }, second.patch!)
    expect(wrong).toBeNull()
    // A full list always applies, whatever the receiver had.
    const reset = diffTabs(null, [tab('z')], iconData)
    expect(applyTabPatch({ seq: 7, tabs: [tab('a')], icons: new Map() }, reset.patch!)?.tabs).toEqual([tab('z')])
  })

  test('random edits round-trip exactly', () => {
    let seed = 7
    const rand = (n: number): number => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n }
    const lists: BrowserTabSummary[][] = []
    let current = [tab('t0')]
    for (let step = 0; step < 300; step++) {
      const next = current.map((t) => ({ ...t }))
      const op = rand(5)
      if (op === 0) next.push(tab(`t${step + 1}`, { faviconUrl: rand(2) ? 'sf-icon:1' : 'sf-icon:2' }))
      else if (op === 1 && next.length > 1) next.splice(rand(next.length), 1)
      else if (op === 2 && next.length > 1) next.reverse()
      else if (op === 3 && next.length) next[rand(next.length)]!.title = `title ${step}`
      else if (next.length) next[rand(next.length)]!.loading = !next[rand(next.length)]!.loading
      lists.push(next)
      current = next
    }
    const { received } = roundTrip(lists)
    expect(received?.tabs).toEqual(current)
  })
})

describe('broadcast queue', () => {
  test('a burst inside one frame flushes once per key; state stays dirty across marks', async () => {
    const calls: Array<[string, boolean]> = []
    const queue = createBroadcastQueue<string>((key, state) => calls.push([key, state]), 16)
    queue.mark('w1', false)
    queue.mark('w1', true)
    queue.mark('w1', false)
    queue.mark('w2', false)
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(calls).toEqual([['w1', true], ['w2', false]])
    // A second burst right after a flush waits for the frame to end, then flushes once.
    for (let i = 0; i < 10; i++) queue.mark('w1', false)
    expect(calls.length).toBe(2)
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(calls).toEqual([['w1', true], ['w2', false], ['w1', false]])
  })

  test('flushNow sends pending work immediately; forget drops it', () => {
    const calls: string[] = []
    const queue = createBroadcastQueue<string>((key) => calls.push(key), 16)
    queue.mark('a', false)
    queue.mark('b', false)
    queue.forget('b')
    queue.flushNow()
    expect(calls).toEqual(['a'])
    expect(queue.pending).toBe(0)
  })
})
