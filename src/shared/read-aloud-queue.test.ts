import { describe, expect, test } from 'bun:test'
import { pcm16ToFloat32, ReadAloudPlan } from './read-aloud-queue'

describe('ReadAloudPlan', () => {
  test('generates the current sentence, then prefetches one ahead, then waits', () => {
    const plan = new ReadAloudPlan(4)
    expect(plan.nextToGenerate()).toBe(0)
    plan.beginGenerating(0, 0)
    expect(plan.nextToGenerate()).toBeNull() // one request at a time
    plan.finishGenerating(0, 2)
    expect(plan.nextToGenerate()).toBe(1)
    expect(plan.startTimeFor(1, 0.5, 0.1)).toBeCloseTo(2.1)
    plan.beginGenerating(1, 2.1)
    plan.finishGenerating(1, 4)
    expect(plan.nextToGenerate()).toBeNull() // 2 is two ahead of the one being heard
    expect(plan.tick(1).index).toBe(0)
    const moved = plan.tick(2.5)
    expect(moved).toEqual({ index: 1, changed: true, finished: false })
    expect(plan.nextToGenerate()).toBe(2)
  })

  test('finishes after the last sentence has played', () => {
    const plan = new ReadAloudPlan(2)
    plan.beginGenerating(0, 0)
    plan.finishGenerating(0, 1)
    plan.beginGenerating(1, 1)
    plan.finishGenerating(1, 2)
    expect(plan.tick(1.5).finished).toBe(false)
    expect(plan.tick(2).finished).toBe(true)
  })

  test('a sentence still generating is never skipped past, even when its scheduled audio ran out', () => {
    const plan = new ReadAloudPlan(3)
    plan.beginGenerating(0, 0)
    expect(plan.tick(10).index).toBe(0)
  })

  test('a failed sentence is skipped instead of stalling', () => {
    const plan = new ReadAloudPlan(3)
    plan.beginGenerating(0, 0)
    plan.failGenerating(0)
    expect(plan.tick(0).index).toBe(1)
    expect(plan.nextToGenerate()).toBe(1)
  })

  test('jump drops the timeline and bumps the generation (stale audio is ignored)', () => {
    const plan = new ReadAloudPlan(5)
    const first = plan.generation
    plan.beginGenerating(0, 0)
    const next = plan.jump(3)
    expect(next).toBe(first + 1)
    expect(plan.current).toBe(3)
    expect(plan.isGenerating()).toBe(false)
    expect(plan.nextToGenerate()).toBe(3)
    expect(plan.scheduledUntil()).toBe(0)
    expect(plan.jump(99)).toBe(first + 2)
    expect(plan.current).toBe(4)
    expect(plan.nextIndex()).toBeNull()
    expect(plan.previousIndex()).toBe(3)
  })

  test('an empty plan has nothing to do', () => {
    const plan = new ReadAloudPlan(0)
    expect(plan.nextToGenerate()).toBeNull()
    expect(plan.tick(0).finished).toBe(false)
  })
})

test('pcm16ToFloat32 decodes little-endian samples', () => {
  const bytes = new Uint8Array([0x00, 0x80, 0xff, 0x7f, 0x00, 0x00, 0x01])
  const samples = pcm16ToFloat32(bytes)
  expect(samples.length).toBe(3)
  expect(samples[0]).toBe(-1)
  expect(samples[1]).toBeCloseTo(1, 3)
  expect(samples[2]).toBe(0)
})
