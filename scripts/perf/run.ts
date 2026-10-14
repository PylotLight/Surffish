#!/usr/bin/env bun
// Runs the perf bench against one or more built checkouts and writes the samples as JSON.
//   bun run perf                                  # current checkout (needs `bun run build`), 3 runs
//   bun scripts/perf/run.ts --app main=../sf-main --app pr=. --runs 3 --out perf.json
// Apps are run interleaved (A B, B A, A B ...) so machine noise lands on both sides.
// Each app is launched with its own node_modules Electron when it has one.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { summarize } from './metrics.ts'
import { appPayload } from './app-payload.ts'

const here = import.meta.dir
const config = JSON.parse(readFileSync(join(here, 'perf.config.json'), 'utf8'))

const args = process.argv.slice(2)
const apps: { label: string; dir: string }[] = []
let runs = Number(process.env.PERF_RUNS || config.runs || 3)
// One discarded start-up-only launch per app first: the very first Electron launch on a fresh pod
// pays for the font cache, the shader cache and a cold page cache (up to ~3 s of "first paint").
let warmup = Number(process.env.PERF_WARMUP ?? config.warmup ?? 1)
// Start-up-only launches on the profile the warm-up left behind (V8 code cache, HTTP cache and
// window state already there): the "returning user" start. Needs a warm-up; 0 turns them off.
let warmStarts = Number(process.env.PERF_WARM_STARTS ?? config.warmStarts ?? 0)
// --trace <dir>: one Chrome trace per app (first measured run), see PERF_TRACE in bench.cjs.
let traceDir = ''
let outFile = ''
for (let i = 0; i < args.length; i++) {
  const a = args[i]!
  if (a === '--app') {
    const [label, dir] = args[++i]!.split('=')
    apps.push({ label: label!, dir: resolve(dir!) })
  } else if (a === '--runs') runs = Number(args[++i])
  else if (a === '--warmup') warmup = Number(args[++i])
  else if (a === '--warm-starts') warmStarts = Number(args[++i])
  else if (a === '--trace') traceDir = resolve(args[++i]!)
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

/**
 * Main-process JS evaluated at launch: index.js and everything it imports statically, plus a
 * top-level `await import()` in index.js itself (the boot entry that turns on the compile cache
 * before importing the app). Lazy `import()`s elsewhere (reader, page watchers, ...) don't count.
 */
export function mainStartupFiles(mainDir: string): string[] {
  const seen = new Set<string>()
  const visit = (file: string, entry: boolean) => {
    if (seen.has(file) || !existsSync(file)) return
    seen.add(file)
    const src = readFileSync(file, 'utf8')
    const specs = [...src.matchAll(/(?:^|[;\n])\s*(?:import|export)\s[^;\n]*?from\s*"(\.[^"]+)"|(?:^|[;\n])\s*import\s*"(\.[^"]+)"/g)].map((m) => m[1] ?? m[2]!)
    if (entry) specs.push(...[...src.matchAll(/^await import\("(\.[^"]+)"\)/gm)].map((m) => m[1]!))
    for (const spec of specs) visit(resolve(dirname(file), spec), false)
  }
  visit(join(mainDir, 'index.js'), true)
  return [...seen]
}

/** Build output sizes in bytes. Deterministic, measured once per app. */
export function bundleSizes(dir: string) {
  const out = join(dir, 'out')
  const html = existsSync(join(out, 'renderer/index.html')) ? readFileSync(join(out, 'renderer/index.html'), 'utf8') : ''
  const eager = [...html.matchAll(/<(?:script[^>]*\ssrc|link[^>]*rel="modulepreload"[^>]*\shref)="\.\/([^"]+\.m?js)"/g)].map((m) => join(out, 'renderer', m[1]!))
  return {
    mainJs: total(mainStartupFiles(join(out, 'main'))),
    mainTotal: total(filesUnder(join(out, 'main'), /\.(c|m)?js$/)),
    preload: total(filesUnder(join(out, 'preload'), /\.(c|m)?js$/)),
    rendererEagerJs: total([...new Set(eager)]),
    rendererJs: total(filesUnder(join(out, 'renderer/assets'), /\.m?js$/)),
    rendererCss: total(filesUnder(join(out, 'renderer/assets'), /\.css$/)),
    ...appPayload(dir)
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
type Launch = 'run' | 'warmup' | 'warm-start'
const profileOf = (app: { label: string }) => join(tmp, `${app.label}-profile`)
function sample(app: { label: string; dir: string }, n: number, launch: Launch = 'run'): Record<string, unknown> | null {
  if (!existsSync(join(app.dir, 'out/main/index.js'))) throw new Error(`${app.dir} has no out/main/index.js (run bun run build there)`)
  const warm = launch !== 'run'
  const out = join(tmp, `${app.label}-${launch}-${n}.json`)
  const trace = traceDir && launch === 'run' && n === 0 ? join(traceDir, `${app.label}-startup-trace.json`) : ''
  const extra = process.platform === 'linux' && process.env.ELECTRON_DISABLE_SANDBOX ? ['--no-sandbox'] : []
  for (let attempt = 1; attempt <= 2; attempt++) {
    const started = Date.now()
    const r = spawnSync(electronFor(app.dir), [...extra, bench], {
      cwd: app.dir,
      env: {
        ...process.env, PERF_APP_DIR: app.dir, PERF_OUT: out, PERF_CONFIG: JSON.stringify(config.bench ?? {}), PERF_WARMUP: warm ? '1' : '',
        // The warm-up and warm starts share one kept profile per app; measured runs start from a fresh one.
        PERF_USER_DATA: warm && warmStarts > 0 ? profileOf(app) : '',
        PERF_TRACE: trace
      },
      encoding: 'utf8',
      timeout: 150_000,
      maxBuffer: 64 * 1024 * 1024
    })
    const secs = ((Date.now() - started) / 1000).toFixed(1)
    if (r.status === 0 && existsSync(out)) {
      const s = JSON.parse(readFileSync(out, 'utf8'))
      const toolbar = s.startup?.phases?.toolbarReadyMs
      if (launch === 'warmup') { console.error(`[perf] ${app.label} warm-up ok (${secs}s, first paint ${s.startup?.firstPaintMs}ms, discarded)`); rmSync(out, { force: true }); return s }
      if (launch === 'warm-start') { console.error(`[perf] ${app.label} warm start ${n} ok (${secs}s) firstPaint=${s.startup?.firstPaintMs}ms toolbar=${toolbar}ms`); rmSync(out, { force: true }); return s }
      console.error(`[perf] ${app.label} run ${n} ok (${secs}s) firstPaint=${s.startup?.firstPaintMs}ms toolbar=${toolbar}ms ipcOpen=${s.openTabs?.ipcCount} mem30=${s.memMax?.totalMB}MB switch=${s.tabSwitch?.medianMs}ms`)
      rmSync(out, { force: true })
      return s
    }
    const tail = `${r.stdout ?? ''}\n${r.stderr ?? ''}`.split('\n').filter((l) => l.includes('[perf]') || /error/i.test(l)).slice(-12).join('\n')
    console.error(`[perf] ${app.label} run ${n} attempt ${attempt} failed (status ${r.status}, ${r.signal ?? ''}, ${secs}s)\n${tail}`)
  }
  return null
}

const results: Record<string, { dir: string; bundle: ReturnType<typeof bundleSizes>; samples: Record<string, unknown>[]; warmSamples: Record<string, unknown>[]; failures: number; median: Record<string, number> }> = {}
for (const app of apps) results[app.label] = { dir: app.dir, bundle: bundleSizes(app.dir), samples: [], warmSamples: [], failures: 0, median: {} }
if (traceDir) mkdirSync(traceDir, { recursive: true })
const started = Date.now()
for (let n = 0; n < warmup; n++) for (const app of apps) sample(app, n, 'warmup')
for (let n = 0; n < runs; n++) {
  const order = n % 2 === 0 ? apps : [...apps].reverse()
  for (const app of order) {
    const s = sample(app, n)
    if (s) results[app.label]!.samples.push(s)
    else results[app.label]!.failures++
  }
}
// Warm starts last, interleaved: by now the pod's first-launch costs (fonts, shaders, page cache) are long
// paid, so warm vs cold compares the profile, not the machine warming up (run first, they were slower than cold).
if (warmup > 0) {
  for (let n = 0; n < warmStarts; n++) {
    for (const app of n % 2 === 0 ? apps : [...apps].reverse()) {
      const s = sample(app, n, 'warm-start')
      if (s) results[app.label]!.warmSamples.push(s)
    }
  }
}
for (const app of apps) rmSync(profileOf(app), { recursive: true, force: true })
// `median` holds each metric's aggregate: the median, or the minimum for metrics with "stat": "min".
for (const r of Object.values(results)) r.median = summarize(r.samples, r.bundle, config.metrics, r.warmSamples)
rmSync(tmp, { recursive: true, force: true })
const report = { platform: process.platform, arch: process.arch, runs, warmup, warmStarts: warmup > 0 ? warmStarts : 0, seconds: Math.round((Date.now() - started) / 1000), config, apps: results }
const json = JSON.stringify(report, null, 2)
if (outFile) writeFileSync(outFile, json)
console.log(JSON.stringify(Object.fromEntries(Object.entries(results).map(([k, v]) => [k, { failures: v.failures, median: v.median }])), null, 2))
if (Object.values(results).some((r) => r.samples.length === 0)) {
  console.error('[perf] an app produced no samples')
  process.exit(1)
}
