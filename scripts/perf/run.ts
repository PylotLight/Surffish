#!/usr/bin/env bun
// Runs the perf bench against one or more built checkouts and writes the samples as JSON.
//   bun run perf                                  # current checkout (needs `bun run build`), 3 runs
//   bun scripts/perf/run.ts --app main=../sf-main --app pr=. --runs 3 --out perf.json
// Apps are run interleaved (A B, B A, A B ...) so machine noise lands on both sides.
// Each app is launched with its own node_modules Electron when it has one.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { flatten, median } from './metrics.ts'

const here = import.meta.dir
const config = JSON.parse(readFileSync(join(here, 'perf.config.json'), 'utf8'))

const args = process.argv.slice(2)
const apps: { label: string; dir: string }[] = []
let runs = Number(process.env.PERF_RUNS || config.runs || 3)
let outFile = ''
for (let i = 0; i < args.length; i++) {
  const a = args[i]!
  if (a === '--app') {
    const [label, dir] = args[++i]!.split('=')
    apps.push({ label: label!, dir: resolve(dir!) })
  } else if (a === '--runs') runs = Number(args[++i])
  else if (a === '--out') outFile = args[++i]!
  else throw new Error(`unknown argument ${a}`)
}
if (apps.length === 0) apps.push({ label: 'local', dir: process.cwd() })

const sizeOf = (p: string) => (existsSync(p) ? statSync(p).size : 0)
const filesUnder = (dir: string, re: RegExp): string[] => {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && re.test(e.name))
    .map((e) => join(e.parentPath, e.name))
}
const total = (files: string[]) => files.reduce((n, f) => n + sizeOf(f), 0)

/** Build output sizes in bytes. Deterministic, measured once per app. */
export function bundleSizes(dir: string) {
  const out = join(dir, 'out')
  const html = existsSync(join(out, 'renderer/index.html')) ? readFileSync(join(out, 'renderer/index.html'), 'utf8') : ''
  const eager = [...html.matchAll(/<(?:script[^>]*\ssrc|link[^>]*rel="modulepreload"[^>]*\shref)="\.\/([^"]+\.m?js)"/g)].map((m) => join(out, 'renderer', m[1]!))
  return {
    mainJs: sizeOf(join(out, 'main/index.js')),
    mainTotal: total(filesUnder(join(out, 'main'), /\.(c|m)?js$/)),
    preload: total(filesUnder(join(out, 'preload'), /\.(c|m)?js$/)),
    rendererEagerJs: total([...new Set(eager)]),
    rendererJs: total(filesUnder(join(out, 'renderer/assets'), /\.m?js$/)),
    rendererCss: total(filesUnder(join(out, 'renderer/assets'), /\.css$/))
  }
}

// The Electron binary itself (what require('electron') returns), not node_modules/.bin/electron,
// so no `#!/usr/bin/env node` wrapper process sits between the bench and the app.
function electronFor(dir: string): string {
  for (const d of [dir, process.cwd()]) {
    const pkg = join(d, 'node_modules/electron')
    if (existsSync(join(pkg, 'path.txt'))) return join(pkg, 'dist', readFileSync(join(pkg, 'path.txt'), 'utf8').trim())
  }
  throw new Error(`no installed Electron in ${dir}/node_modules or ${process.cwd()}/node_modules (run bun install)`)
}

const tmp = mkdtempSync(join(tmpdir(), 'surffish-perf-'))
const bench = join(here, 'bench.cjs')
function sample(app: { label: string; dir: string }, n: number): Record<string, unknown> | null {
  if (!existsSync(join(app.dir, 'out/main/index.js'))) throw new Error(`${app.dir} has no out/main/index.js (run bun run build there)`)
  const out = join(tmp, `${app.label}-${n}.json`)
  const extra = process.platform === 'linux' && process.env.ELECTRON_DISABLE_SANDBOX ? ['--no-sandbox'] : []
  for (let attempt = 1; attempt <= 2; attempt++) {
    const started = Date.now()
    const r = spawnSync(electronFor(app.dir), [...extra, bench], {
      cwd: app.dir,
      env: { ...process.env, PERF_APP_DIR: app.dir, PERF_OUT: out, PERF_CONFIG: JSON.stringify(config.bench ?? {}) },
      encoding: 'utf8',
      timeout: 150_000,
      maxBuffer: 64 * 1024 * 1024
    })
    const secs = ((Date.now() - started) / 1000).toFixed(1)
    if (r.status === 0 && existsSync(out)) {
      const s = JSON.parse(readFileSync(out, 'utf8'))
      console.error(`[perf] ${app.label} run ${n} ok (${secs}s) firstPaint=${s.startup?.firstPaintMs}ms ipcOpen=${s.openTabs?.ipcCount} mem30=${s.memMax?.totalMB}MB switch=${s.tabSwitch?.medianMs}ms`)
      rmSync(out, { force: true })
      return s
    }
    const tail = `${r.stdout ?? ''}\n${r.stderr ?? ''}`.split('\n').filter((l) => l.includes('[perf]') || /error/i.test(l)).slice(-12).join('\n')
    console.error(`[perf] ${app.label} run ${n} attempt ${attempt} failed (status ${r.status}, ${r.signal ?? ''}, ${secs}s)\n${tail}`)
  }
  return null
}

const results: Record<string, { dir: string; bundle: ReturnType<typeof bundleSizes>; samples: Record<string, unknown>[]; failures: number; median: Record<string, number> }> = {}
for (const app of apps) results[app.label] = { dir: app.dir, bundle: bundleSizes(app.dir), samples: [], failures: 0, median: {} }
const started = Date.now()
for (let n = 0; n < runs; n++) {
  const order = n % 2 === 0 ? apps : [...apps].reverse()
  for (const app of order) {
    const s = sample(app, n)
    if (s) results[app.label]!.samples.push(s)
    else results[app.label]!.failures++
  }
}
for (const r of Object.values(results)) {
  const flat = r.samples.map((s) => flatten(s))
  const keys = new Set(flat.flatMap((f) => Object.keys(f)))
  for (const k of keys) r.median[k] = median(flat.map((f) => f[k]!).filter((v) => v !== undefined))
  for (const [k, v] of Object.entries(r.bundle)) r.median[`bundle.${k}`] = v
}
rmSync(tmp, { recursive: true, force: true })
const report = { platform: process.platform, arch: process.arch, runs, seconds: Math.round((Date.now() - started) / 1000), config, apps: results }
const json = JSON.stringify(report, null, 2)
if (outFile) writeFileSync(outFile, json)
console.log(JSON.stringify(Object.fromEntries(Object.entries(results).map(([k, v]) => [k, { failures: v.failures, median: v.median }])), null, 2))
if (Object.values(results).some((r) => r.samples.length === 0)) {
  console.error('[perf] an app produced no samples')
  process.exit(1)
}
