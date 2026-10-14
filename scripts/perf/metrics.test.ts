import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { aggregate, compare, compareExitCode, flatten, markdownTable, markdownTables, median, mergeReports, summarize, verdict, type MetricSpec, type PerfConfig, type Row } from './metrics.ts'

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

test('aggregate: median by default, min for stall-prone latencies', () => {
  // perf (linux) on main, identical code: one side's cold starts stalled on a busy pod.
  expect(aggregate([1411, 3764, 292])).toBe(1411)
  expect(aggregate([1411, 3764, 292], 'min')).toBe(292)
  expect(aggregate([NaN, 5, 3], 'min')).toBe(3)
  expect(aggregate([], 'min')).toBeNaN()
})

test('cold start uses the best run, so a stalled run is not a regression but a slower build is', () => {
  const spec = config.metrics['startup.firstPaintMs']!
  expect(spec.stat).toBe('min')
  const main = aggregate([277, 367, 269], spec.stat)
  expect(verdict(spec, config, main, aggregate([1411, 3764, 292], spec.stat), 'linux')).toBe('ok')
  expect(verdict(spec, config, main, aggregate([520, 610, 480], spec.stat), 'linux')).toBe('fail')
})

test('deterministic metrics fail just past 5%', () => {
  expect(verdict(det, config, 1000, 1050, 'linux')).toBe('ok')
  expect(verdict(det, config, 1000, 1051, 'linux')).toBe('fail')
  expect(verdict(det, config, 1000, 900, 'linux')).toBe('better')
})

test('warnOnly metrics never fail, deterministic or noisy', () => {
  expect(verdict({ ...det, warnOnly: true }, config, 1000, 2000, 'linux')).toBe('warn')
  expect(verdict({ ...det, warnOnly: true }, config, 1000, 1050, 'linux')).toBe('ok')
  expect(verdict({ ...det, warnOnly: true }, config, 1000, 500, 'linux')).toBe('better')
  expect(verdict({ ...noisy, warnOnly: true }, config, 100, 200, 'linux')).toBe('warn')
  for (const key of ['sites.renderers', 'sites.memMB', 'adblock.frameStartBytes', 'adblock.frameStartMainMs', 'adblock.frameUpdates', 'adblock.sameDocFrameStarts']) {
    expect(config.metrics[key]?.warnOnly).toBe(true)
  }
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
  expect(md).toContain('| main JS at startup (index.js + imports) ¹ | 2.0 KB | 2.0 KB | 0.0% | ✅ ok |')
})

test('GPU memory only warns on linux (bimodal under SwiftShader), per-metric override of noisyFail', () => {
  const gpu = config.metrics['memMax.gpuMB']!
  // Oct 2026 CI, identical code: 59 -> 77 MB and 66 -> 92 MB.
  expect(verdict(gpu, config, 59, 77, 'linux')).toBe('warn')
  expect(verdict(gpu, config, 66, 92, 'linux')).toBe('warn')
  expect(verdict({ ...noisy, platforms: { darwin: { noisyFail: true } } }, config, 100, 130, 'darwin')).toBe('fail')
  expect(verdict(noisy, config, 100, 130, 'linux')).toBe('fail') // other noisy metrics still fail on linux
})

test('IPC while opening tabs is timing-dependent, so a one-pass swing is noisy (confirmed before failing)', () => {
  expect(config.metrics['openTabs.ipcBytes']!.kind).toBe('noisy')
  expect(config.metrics['openTabs.ipcCount']!.kind).toBe('noisy')
  expect(verdict(config.metrics['openTabs.ipcBytes']!, config, 59.1 * 1024, 73 * 1024, 'linux')).toBe('fail')
})

test('compare exits 3 when only noisy metrics fail, so CI benches again before failing', () => {
  const row = (kind: Row['kind'], status: Row['status']): Row => ({ key: kind, label: kind, unit: '', kind, base: 1, head: 2, deltaPct: 100, status })
  expect(compareExitCode([row('noisy', 'ok'), row('deterministic', 'warn')])).toBe(0)
  expect(compareExitCode([row('noisy', 'fail'), row('noisy', 'fail')])).toBe(3)
  expect(compareExitCode([row('noisy', 'fail'), row('deterministic', 'fail')])).toBe(1)
  expect(compareExitCode([row('leak', 'fail')])).toBe(1)
})

test('a confirmation pass is pooled per app and every aggregate recomputed', () => {
  const app = (windowMs: number[], failures = 0) => ({ bundle: { mainJs: 10 }, failures, median: {}, samples: windowMs.map((ms) => ({ startup: { windowMs: ms }, memMax: { totalMB: ms / 10 } })) })
  const first = { runs: 3, seconds: 60, config, apps: { main: app([120, 125, 130]), pr: app([260, 250, 270]) } }
  const second = { runs: 3, seconds: 55, config, apps: { main: app([121, 140, 150]), pr: app([118, 122, 900], 1) } }
  const merged = mergeReports(first, second)
  expect(merged.runs).toBe(6)
  expect(merged.confirmRuns).toBe(3)
  expect(merged.apps.pr!.samples).toHaveLength(6)
  expect(merged.apps.pr!.failures).toBe(1)
  // startup.windowMs is "stat": "min": a stall in pass one is outvoted by a clean run in pass two.
  expect(merged.apps.pr!.median['startup.windowMs']).toBe(118)
  expect(merged.apps.main!.median['startup.windowMs']).toBe(120)
  expect(merged.apps.pr!.median['memMax.totalMB']).toBe(25) // median of 11.8 12.2 25 26 27 90
  expect(merged.apps.pr!.median['bundle.mainJs']).toBe(10)
  expect(verdict(config.metrics['startup.windowMs']!, config, 120, 118, 'linux')).toBe('ok')
})

test('start-up phase metrics are warn-only: a big slowdown warns, never fails, on every platform', () => {
  const phases = Object.entries(config.metrics).filter(([, spec]) => spec.group === 'phases')
  expect(phases.length).toBeGreaterThanOrEqual(8)
  for (const [key, spec] of phases) {
    expect(spec.warnOnly, key).toBe(true)
    expect(spec.stat, key).toBe('min')
    expect(config.groups?.[spec.group!]?.title).toBeTruthy()
    for (const platform of ['linux', 'darwin']) expect(verdict(spec, config, 400, 4000, platform)).toBe('warn')
  }
  // warnOnly holds for deterministic metrics too.
  expect(verdict({ ...det, warnOnly: true }, config, 1000, 2000, 'linux')).toBe('warn')
  const rows = compare(config, { 'startup.phases.toolbarReadyMs': 400 }, { 'startup.phases.toolbarReadyMs': 4000 }, 'linux')
  expect(compareExitCode(rows)).toBe(0)
})

test('grouped metrics render as their own titled table after the main one', () => {
  const rows = compare(config, {}, {}, 'linux')
  const md = markdownTables(rows, config.groups)
  const [main, rest] = md.split(`#### ${config.groups!.phases!.title}`)
  expect(rest).toBeDefined()
  expect(main).toContain('cold start to first paint')
  expect(main).not.toContain('toolbar rendered')
  expect(rest).toContain('toolbar rendered')
  expect(rest).toContain('deferred: extensions ready')
  // Every configured metric still shows exactly once.
  for (const spec of Object.values(config.metrics)) expect(md.split(`| ${spec.label}`).length - 1, spec.label).toBe(1)
})

test('warm starts aggregate under warm.*, separately from the cold runs', () => {
  const cold = [{ startup: { firstPaintMs: 520, phases: { toolbarReadyMs: 430 } } }, { startup: { firstPaintMs: 500, phases: { toolbarReadyMs: 410 } } }]
  const warm = [{ startup: { firstPaintMs: 470, phases: { toolbarReadyMs: 380 } } }, { startup: { firstPaintMs: 460, phases: { toolbarReadyMs: 395 } } }]
  const m = summarize(cold, { mainJs: 1 }, config.metrics, warm)
  expect(m['startup.firstPaintMs']).toBe(500)
  expect(m['warm.startup.firstPaintMs']).toBe(460)
  expect(m['warm.startup.phases.toolbarReadyMs']).toBe(380)
  expect(m['bundle.mainJs']).toBe(1)
  expect(summarize(cold, {}, config.metrics)['warm.startup.firstPaintMs']).toBeUndefined()
})

test('a confirmation pass keeps the first pass warm starts', () => {
  const app = (warm: number[]) => ({ bundle: {}, samples: [{ startup: { firstPaintMs: 500 } }], warmSamples: warm.map((v) => ({ startup: { firstPaintMs: v } })), failures: 0, median: {} })
  const first = { runs: 3, seconds: 1, config, apps: { main: app([470, 480]), pr: app([460]) } }
  const second = { runs: 3, seconds: 1, config, apps: { main: { ...app([]), warmSamples: undefined }, pr: app([]) } }
  const merged = mergeReports(first, second as never)
  expect(merged.apps.main!.median['warm.startup.firstPaintMs']).toBe(470)
  expect(merged.apps.pr!.median['warm.startup.firstPaintMs']).toBe(460)
})
