#!/usr/bin/env bun
// Experiment only (mac-hidden-exp workflow): merges several run.ts reports (one per hidden mode and
// round, so the modes run interleaved) into one report that compare.ts can read, recomputing medians.
//   bun scripts/ci/hidden-perf-merge.ts out.json a.json b.json ...
// Also prints a compact per-mode table of the timing metrics hidden mode can affect.
import { readFileSync, writeFileSync } from 'node:fs'
import { flatten, median } from '../perf/metrics.ts'

const [outFile, ...inputs] = process.argv.slice(2)
if (!outFile || inputs.length === 0) throw new Error('usage: hidden-perf-merge.ts out.json in.json...')
let merged: any = null
for (const file of inputs) {
  let report: any
  try { report = JSON.parse(readFileSync(file, 'utf8')) } catch { console.error(`skip ${file} (unreadable)`); continue }
  if (!merged) merged = { ...report, apps: {}, runs: 0, seconds: 0 }
  merged.seconds += report.seconds ?? 0
  for (const [label, app] of Object.entries<any>(report.apps)) {
    const into = (merged.apps[label] ??= { dir: app.dir, bundle: app.bundle, samples: [], failures: 0, median: {} })
    into.samples.push(...app.samples)
    into.failures += app.failures
  }
}
if (!merged) throw new Error('no readable reports')
for (const app of Object.values<any>(merged.apps)) {
  const flat = app.samples.map((s: unknown) => flatten(s))
  const keys = new Set<string>(flat.flatMap((f: Record<string, number>) => Object.keys(f)))
  for (const k of keys) app.median[k] = median(flat.map((f: Record<string, number>) => f[k]!).filter((v: number | undefined) => v !== undefined))
  for (const [k, v] of Object.entries<number>(app.bundle)) app.median[`bundle.${k}`] = v
  merged.runs = Math.max(merged.runs, app.samples.length)
}
writeFileSync(outFile, JSON.stringify(merged, null, 2))
const keys = ['startup.windowMs', 'startup.firstPaintMs', 'tabSwitch.medianMs', 'newTab.siteFirstPaintMs', 'newTab.newTabPageMs',
  'idle.backgroundTabsCpuMsPerSec', 'idle.shellCpuMsPerSec', 'idle.mainCpuMsPerSec', 'mem1.totalMB', 'memMax.totalMB', 'memMax.gpuMB', 'windowCycles.memGrowthMB']
const labels = Object.keys(merged.apps)
const lines = [`| metric | ${labels.map((l) => `${l} (n=${merged.apps[l].samples.length}, failed ${merged.apps[l].failures})`).join(' | ')} |`, `|---|${labels.map(() => '---').join('|')}|`]
for (const k of keys) lines.push(`| ${k} | ${labels.map((l) => merged.apps[l].median[k] ?? 'n/a').join(' | ')} |`)
console.log(lines.join('\n'))
