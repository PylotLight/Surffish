import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { compare, flatten, markdownTable, median, verdict, type MetricSpec, type PerfConfig } from './metrics.ts'

const config = JSON.parse(readFileSync(join(import.meta.dir, 'perf.config.json'), 'utf8')) as PerfConfig
const det: MetricSpec = { kind: 'deterministic', label: 'd', unit: '' }
const noisy: MetricSpec = { kind: 'noisy', label: 'n', unit: 'ms', abs: 10 }
const leak: MetricSpec = { kind: 'leak', label: 'l', unit: '' }

test('flatten keeps finite numbers under dotted keys', () => {
  expect(flatten({ a: { b: 1, c: null, d: 'x' }, e: NaN, f: [1], g: 2 })).toEqual({ 'a.b': 1, g: 2 })
})

test('median picks the lower middle sample', () => {
  expect(median([3, 1, 2])).toBe(2)
  expect(median([4, 1, 3, 2])).toBe(2)
  expect(median([])).toBeNaN()
})

test('deterministic metrics fail just past 5%', () => {
  expect(verdict(det, config, 1000, 1050, 'linux')).toBe('ok')
  expect(verdict(det, config, 1000, 1051, 'linux')).toBe('fail')
  expect(verdict(det, config, 1000, 900, 'linux')).toBe('better')
})

test('absolute slack ignores tiny changes from zero', () => {
  const idle: MetricSpec = { ...det, abs: 2 }
  expect(verdict(idle, config, 0, 2, 'linux')).toBe('ok')
  expect(verdict(idle, config, 0, 3, 'linux')).toBe('fail')
})

test('noisy metrics warn past 10% and fail past 25% on linux only', () => {
  expect(verdict(noisy, config, 100, 108, 'linux')).toBe('ok')
  expect(verdict(noisy, config, 100, 115, 'linux')).toBe('warn')
  expect(verdict(noisy, config, 100, 130, 'linux')).toBe('fail')
  expect(verdict(noisy, config, 100, 130, 'darwin')).toBe('warn')
  expect(verdict(noisy, config, 20, 29, 'linux')).toBe('ok') // +45% but under the 10 ms floor
})

test('leaks fail on any growth beyond main', () => {
  expect(verdict(leak, config, 0, 0, 'linux')).toBe('ok')
  expect(verdict(leak, config, 0, 1, 'linux')).toBe('fail')
  expect(verdict(leak, config, 3, 3, 'linux')).toBe('ok')
  expect(verdict(leak, config, 9, 0, 'linux')).toBe('better')
})

test('missing values are n/a and the table renders every configured metric', () => {
  const rows = compare(config, { 'bundle.mainJs': 2048 }, { 'bundle.mainJs': 2048 }, 'linux')
  expect(rows.find((r) => r.key === 'bundle.mainJs')!.status).toBe('ok')
  expect(rows.find((r) => r.key === 'startup.firstPaintMs')!.status).toBe('n/a')
  const md = markdownTable(rows)
  expect(md.split('\n')).toHaveLength(2 + Object.keys(config.metrics).length)
  expect(md).toContain('| main bundle (index.js) ¹ | 2.0 KB | 2.0 KB | 0.0% | ✅ ok |')
})
