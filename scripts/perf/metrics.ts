// Pure helpers for the perf check: flattening samples, medians, and the regression verdicts.
// Unit-tested in metrics.test.ts.

export type Kind = 'deterministic' | 'noisy' | 'leak'
export type Status = 'ok' | 'better' | 'warn' | 'fail' | 'n/a'
export type Stat = 'median' | 'min'
export interface MetricSpec {
  kind: Kind; label: string; unit: string; abs?: number; warnPct?: number; failPct?: number; stat?: Stat
  /** Per-platform override of the platform's noisyFail (e.g. a metric that only warns on linux). */
  platforms?: Record<string, { noisyFail?: boolean }>
}
export interface PerfConfig {
  defaults: Record<Kind, { abs?: number; warnPct?: number; failPct?: number }>
  platforms?: Record<string, { noisyFail?: boolean }>
  metrics: Record<string, MetricSpec>
}
export interface Row { key: string; label: string; unit: string; kind: Kind; base: number; head: number; deltaPct: number | null; status: Status }

/** {a: {b: 1}} -> {'a.b': 1}; only finite numbers are kept. */
export function flatten(value: unknown, prefix = '', out: Record<string, number> = {}): Record<string, number> {
  if (typeof value === 'number' && Number.isFinite(value)) out[prefix] = value
  else if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [k, v] of Object.entries(value)) flatten(v, prefix ? `${prefix}.${k}` : k, out)
  }
  return out
}

/** Lower median for even counts (a real sample, never an average of two). */
export function median(values: number[]): number {
  const s = values.filter(Number.isFinite).sort((a, b) => a - b)
  return s.length ? s[Math.floor((s.length - 1) / 2)]! : NaN
}

/**
 * One number per metric from a side's samples. `min` is for latencies that machine noise only ever
 * adds to (cold start): a slower build moves every sample, so it moves the minimum too, while a
 * stall on a busy pod in one or two runs (277 ms -> 1411 ms on identical code) no longer flips the median.
 */
export function aggregate(values: number[], stat: Stat = 'median'): number {
  if (stat === 'min') {
    const s = values.filter(Number.isFinite)
    return s.length ? Math.min(...s) : NaN
  }
  return median(values)
}

export function verdict(spec: MetricSpec, config: PerfConfig, base: number, head: number, platform: string): Status {
  if (!Number.isFinite(base) || !Number.isFinite(head)) return 'n/a'
  const d = { ...config.defaults[spec.kind], ...spec }
  const delta = head - base
  if (spec.kind === 'leak') return head > 0 && head > base ? 'fail' : head < base ? 'better' : 'ok'
  const abs = d.abs ?? 0
  const pct = base === 0 ? (delta === 0 ? 0 : Infinity) : (delta / Math.abs(base)) * 100
  const over = (limit: number | undefined) => limit !== undefined && delta > abs && pct > limit
  const noisyFail = spec.platforms?.[platform]?.noisyFail ?? config.platforms?.[platform]?.noisyFail ?? true
  if (spec.kind === 'deterministic') {
    if (over(d.failPct)) return 'fail'
  } else {
    if (noisyFail && over(d.failPct)) return 'fail'
    if (over(d.warnPct) || over(d.failPct)) return 'warn'
  }
  // Improvements beyond the same margins are worth calling out.
  const better = -delta > abs && -pct > (spec.kind === 'deterministic' ? (d.failPct ?? 5) : (d.warnPct ?? 10))
  return better ? 'better' : 'ok'
}

export function compare(config: PerfConfig, base: Record<string, number>, head: Record<string, number>, platform: string): Row[] {
  return Object.entries(config.metrics).map(([key, spec]) => {
    const b = base[key] ?? NaN
    const h = head[key] ?? NaN
    const deltaPct = Number.isFinite(b) && Number.isFinite(h) && b !== 0 ? ((h - b) / Math.abs(b)) * 100 : null
    return { key, label: spec.label, unit: spec.unit, kind: spec.kind, base: b, head: h, deltaPct, status: verdict(spec, config, b, h, platform) }
  })
}

const ICON: Record<Status, string> = { ok: '✅ ok', better: '🟢 better', warn: '⚠️ warn', fail: '❌ fail', 'n/a': '➖ n/a' }
export function formatValue(v: number, unit: string): string {
  if (!Number.isFinite(v)) return '–'
  if (unit === 'KB') return `${(v / 1024).toFixed(1)} KB`
  const n = Math.abs(v) >= 100 ? Math.round(v).toString() : (Math.round(v * 10) / 10).toString()
  return unit ? `${n} ${unit}` : n
}

export function markdownTable(rows: Row[]): string {
  const lines = ['| metric | main | PR | Δ% | status |', '|---|---:|---:|---:|---|']
  for (const r of rows) {
    const d = r.deltaPct === null ? (r.base === r.head ? '0%' : '–') : `${r.deltaPct > 0 ? '+' : ''}${r.deltaPct.toFixed(1)}%`
    lines.push(`| ${r.label}${r.kind === 'noisy' ? '' : ' ¹'} | ${formatValue(r.base, r.unit)} | ${formatValue(r.head, r.unit)} | ${d} | ${ICON[r.status]} |`)
  }
  return lines.join('\n')
}

/** Each metric's aggregate over a side's samples (median, or min where the spec says), plus its bundle sizes. */
export function summarize(samples: Record<string, unknown>[], bundle: Record<string, number>, metrics: Record<string, Partial<MetricSpec>> = {}): Record<string, number> {
  const out: Record<string, number> = {}
  const flat = samples.map((s) => flatten(s))
  const keys = new Set(flat.flatMap((f) => Object.keys(f)))
  for (const k of keys) out[k] = aggregate(flat.map((f) => f[k]!).filter((v) => v !== undefined), metrics[k]?.stat)
  for (const [k, v] of Object.entries(bundle)) out[`bundle.${k}`] = v
  return out
}

interface AppReport { dir?: string; bundle: Record<string, number>; samples: Record<string, unknown>[]; failures: number; median: Record<string, number> }
interface Report { runs: number; seconds: number; config: PerfConfig; apps: Record<string, AppReport>; confirmRuns?: number; [key: string]: unknown }

/**
 * A confirmation bench appended to the first one: samples are pooled per app and every aggregate is
 * recomputed, so a timing "regression" from one noisy stretch of the runner has to show up again on a
 * second interleaved pass before it can fail the check (a real slowdown moves both passes).
 */
export function mergeReports(first: Report, second: Report): Report {
  const apps: Record<string, AppReport> = {}
  for (const [label, a] of Object.entries(first.apps)) {
    const b = second.apps[label]
    const samples = [...a.samples, ...(b?.samples ?? [])]
    apps[label] = { ...a, samples, failures: a.failures + (b?.failures ?? 0), median: summarize(samples, a.bundle, first.config.metrics) }
  }
  return { ...first, runs: first.runs + second.runs, seconds: first.seconds + second.seconds, confirmRuns: second.runs, apps }
}

/** Exit status for compare.ts: 0 clean, 1 a failure, 3 only timing/memory ("noisy") metrics failed. */
export function compareExitCode(rows: Row[]): number {
  const fails = rows.filter((r) => r.status === 'fail')
  if (fails.length === 0) return 0
  return fails.every((r) => r.kind === 'noisy') ? 3 : 1
}
