#!/usr/bin/env bun
// Compares two apps from a run.ts report and prints a markdown table.
//   bun scripts/perf/compare.ts perf.json --base main --head pr [--title "Perf (linux)"] [--markdown out.md]
// Exit code 1 when any metric fails its threshold (scripts/perf/perf.config.json), 0 otherwise.
import { readFileSync, writeFileSync } from 'node:fs'
import { compare, markdownTable, type PerfConfig } from './metrics.ts'

const args = process.argv.slice(2)
const file = args[0]?.startsWith('--') ? undefined : args[0]
const opt = (name: string, fallback = '') => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1]! : fallback }
if (!file) throw new Error('usage: compare.ts <report.json> --base <label> --head <label> [--title t] [--markdown out.md]')
const report = JSON.parse(readFileSync(file, 'utf8'))
const baseLabel = opt('base', 'main')
const headLabel = opt('head', 'pr')
const base = report.apps[baseLabel]
const head = report.apps[headLabel]
if (!base || !head) throw new Error(`report has apps ${Object.keys(report.apps).join(', ')}`)
const config = report.config as PerfConfig
const rows = compare(config, base.median, head.median, report.platform)
const fails = rows.filter((r) => r.status === 'fail')
const warns = rows.filter((r) => r.status === 'warn')
const noisyFail = config.platforms?.[report.platform]?.noisyFail ?? true

const summary = fails.length ? `❌ ${fails.length} regression${fails.length > 1 ? 's' : ''}` : warns.length ? `⚠️ ${warns.length} warning${warns.length > 1 ? 's' : ''}, no hard regressions` : '✅ no regressions'
const sample = head.samples[0] ?? {}
const md = [
  `### ${opt('title', `Perf check (${report.platform})`)}: ${summary}`,
  '',
  `Median of ${base.samples.length} (main) / ${head.samples.length} (PR) cold runs each, interleaved on one runner (${report.platform} ${report.arch}, Electron ${sample.electron ?? '?'}, ${report.seconds}s).` +
    (base.failures + head.failures ? ` ${base.failures + head.failures} run(s) failed and were skipped.` : ''),
  '',
  markdownTable(rows),
  '',
  `¹ deterministic: fails above its threshold. Others are timing/memory: warn above ${config.defaults.noisy.warnPct}%` +
    (noisyFail ? `, fail above ${config.defaults.noisy.failPct}%.` : ', never fail on this runner.') +
    ' Small absolute changes are ignored (see scripts/perf/perf.config.json, docs/perf.md).',
  '',
  '<details><summary>IPC while opening tabs, top channels</summary>',
  '',
  '```',
  `main: ${JSON.stringify(base.samples[0]?.openTabs?.top ?? {})}`,
  `PR:   ${JSON.stringify(head.samples[0]?.openTabs?.top ?? {})}`,
  '```',
  '</details>',
  ''
].join('\n')

console.log(md)
const out = opt('markdown')
if (out) writeFileSync(out, md)
process.exit(fails.length ? 1 : 0)
