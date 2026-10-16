import { describe, expect, test } from 'bun:test'
import { MINI_HEADER_LOADING_DELAY_MS, MINI_HEADER_TITLE_THROTTLE_MS, createHeaderStateGate } from './mini-window-header-sync'

type State = { title: string; url: string; loading: boolean }
const base: State = { title: 'Chat · Hark', url: 'hark.example/chat', loading: false }

function gate() {
  let now = 1000
  const g = createHeaderStateGate<State>({ now: () => now })
  /** Plan and, when it sends, mark it sent (what main does). */
  const push = (state: State, extra?: string) => {
    const plan = g.plan(state, extra)
    if (plan.send) g.sent(plan.send, extra)
    return plan
  }
  return { g, push, tick: (ms: number) => { now += ms } }
}

describe('mini window header state gate', () => {
  test('the first push always goes out', () => {
    const { g } = gate()
    expect(g.plan(base)).toEqual({ send: base, recheckMs: null })
  })

  test('an update that changes nothing the header shows is dropped', () => {
    const { push, tick } = gate()
    push(base)
    for (let key = 0; key < 20; key += 1) {
      tick(16)
      expect(push({ ...base })).toEqual({ send: null, recheckMs: null })
    }
  })

  test('a same-document load per keystroke (replaceState: start, URL, stop) never shows as loading', () => {
    const { push, tick } = gate()
    push(base, 'url?draft=0')
    for (let key = 1; key <= 10; key += 1) {
      // did-start-loading: held back (a recheck in case it lasts).
      let plan = push({ ...base, loading: true }, `url?draft=${key - 1}`)
      expect(plan.send).toBeNull()
      expect(plan.recheckMs).toBe(MINI_HEADER_LOADING_DELAY_MS)
      tick(8)
      // did-navigate-in-page: the tab URL changed (main sends it), but still not loading.
      plan = push({ ...base, loading: true }, `url?draft=${key}`)
      expect(plan.send?.loading).toBe(false)
      tick(8)
      // did-stop-loading: nothing left to send.
      expect(push(base, `url?draft=${key}`)).toEqual({ send: null, recheckMs: null })
      tick(100)
    }
  })

  test('a real load shows once it has lasted the delay, and stops at once', () => {
    const { push, tick } = gate()
    push(base)
    const loading = { ...base, loading: true }
    expect(push(loading)).toEqual({ send: null, recheckMs: MINI_HEADER_LOADING_DELAY_MS })
    tick(120)
    expect(push(loading)).toEqual({ send: null, recheckMs: MINI_HEADER_LOADING_DELAY_MS - 120 })
    tick(MINI_HEADER_LOADING_DELAY_MS - 120)
    expect(push(loading)).toEqual({ send: loading, recheckMs: null })
    tick(1)
    // Shown: stays shown through other updates, goes as soon as the load ends.
    expect(push({ ...loading, url: 'hark.example/next' }).send?.loading).toBe(true)
    expect(push({ ...base, url: 'hark.example/next' })).toEqual({ send: { ...base, url: 'hark.example/next' }, recheckMs: null })
  })

  test('other changes go out at once', () => {
    const { push, tick } = gate()
    push(base)
    tick(5)
    expect(push({ ...base, url: 'hark.example/other' }).send).toEqual({ ...base, url: 'hark.example/other' })
    expect(push({ ...base, url: 'hark.example/other' }, 'a tab joined').send).not.toBeNull()
  })

  test('a title flipping per keystroke is held to one push per throttle window, the last title landing', () => {
    const { push, tick } = gate()
    push(base)
    const typing = { ...base, title: 'typing… Chat · Hark' }
    // First change after a quiet spell: straight out.
    expect(push(typing).send).toEqual(typing)
    tick(100)
    // Flips back 100 ms later: held for the rest of the window.
    expect(push(base)).toEqual({ send: null, recheckMs: MINI_HEADER_TITLE_THROTTLE_MS - 100 })
    tick(50)
    expect(push(typing)).toEqual({ send: null, recheckMs: null })
    tick(50)
    expect(push(base)).toEqual({ send: null, recheckMs: MINI_HEADER_TITLE_THROTTLE_MS - 200 })
    tick(MINI_HEADER_TITLE_THROTTLE_MS - 200)
    // The trailing push: the latest title.
    expect(push(base).send).toEqual(base)
  })

  test('a title change together with something else is not held', () => {
    const { push, tick } = gate()
    push(base)
    push({ ...base, title: 'New' })
    tick(10)
    expect(push({ ...base, title: 'Newer', url: 'hark.example/next' }).send?.title).toBe('Newer')
  })

  test('reset (a reloaded header page): the next push goes out even if nothing changed', () => {
    const { g, push } = gate()
    push(base)
    expect(push(base).send).toBeNull()
    g.reset()
    expect(push(base).send).toEqual(base)
  })
})
