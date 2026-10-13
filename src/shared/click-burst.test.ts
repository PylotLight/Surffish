import { describe, expect, test } from 'bun:test'
import { EMPTY_CLICK_BURST, registerClick, TRIPLE_CLICK, type ClickBurst } from './click-burst'

function clicks(times: number[]): boolean[] {
  let burst: ClickBurst = EMPTY_CLICK_BURST
  return times.map((time) => {
    const result = registerClick(burst, time)
    burst = result.burst
    return result.fired
  })
}

describe('click burst (logo triple-click)', () => {
  test('three quick clicks fire on the third', () => {
    expect(clicks([0, 200, 400])).toEqual([false, false, true])
  })

  test('a slow click starts a new burst', () => {
    expect(clicks([0, 200, 200 + TRIPLE_CLICK.gapMs + 1, 900, 1100])).toEqual([false, false, false, false, true])
  })

  test('the burst resets after firing (six quick clicks fire twice, not four times)', () => {
    expect(clicks([0, 100, 200, 300, 400, 500])).toEqual([false, false, true, false, false, true])
  })

  test('single and double clicks never fire', () => {
    expect(clicks([0])).toEqual([false])
    expect(clicks([0, 100])).toEqual([false, false])
  })

  test('a clock going backwards starts over instead of firing', () => {
    expect(clicks([1000, 1100, 500])).toEqual([false, false, false])
  })

  test('custom counts', () => {
    let burst: ClickBurst = EMPTY_CLICK_BURST
    const fired: boolean[] = []
    for (const time of [0, 50, 100, 150, 200]) {
      const result = registerClick(burst, time, { count: 5, gapMs: 100 })
      burst = result.burst
      fired.push(result.fired)
    }
    expect(fired).toEqual([false, false, false, false, true])
  })
})
