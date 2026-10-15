# Perf check

Every PR gets a perf comparison against its base: CI builds both, runs the same bench on each
(interleaved, on the same machine, after one discarded warm-up launch per side), and compares
medians (cold-start times use the best run, see below). Deterministic metrics fail the check
on a regression; timing and memory metrics mostly warn, because shared runners are noisy.

- `perf (linux)`: k3s runner pod under xvfb (software rendering). The pods see 16 CPUs (`nproc`)
  but are limited to 8 by their cgroup quota (`cpu.max` 800000/100000), and other jobs share the
  node, so timings still vary. Writes the table to the job's step summary and keeps one sticky PR
  comment up to date.
- `perf (macos)`: opt-in, on the self-hosted Mac (real GPU, macOS memory accounting). Runs only on
  PRs with the `perf-mac` label or from a manual *Run workflow*. Timing and memory never fail there
  (the machine is in use); deterministic metrics still can. Step summary always; PR comment only
  when the runner has `SURFFISH_GH_PROXY` set (see below). It never runs a second `bun install`:
  the base build shares the PR's `node_modules` when the dependencies match (`bun.lock` and
  `package.json` outside `scripts`), otherwise the Mac comparison is skipped and the summary says so.
- `macos smoke`: the core Electron smokes on real macOS (security, table stakes, multi-window,
  tab groups, split view, adblock, nav errors). The sidebar-overlay smoke stays Linux-only because
  it moves the cursor with xdotool.

On push to `main` the Linux perf job compares the new commit against the previous `main`, so the step
summary on main doubles as the running baseline. Docs-only changes skip CI (`paths-ignore`).

The Linux job skips the bench itself (and says so in the summary and the sticky comment) when no
changed file can reach the built app, its dependencies or the bench: `.github/`, `docs/`, Markdown,
`Casks/`, unit tests (`*.test.*`), and `scripts/` other than `scripts/perf/`, `scripts/smoke-hidden.cjs`,
the `scripts/build-*` steps and `scripts/native-build-cache.ts`. A `package.json` change counts unless
only test scripts changed. Rules and tests: `scripts/perf/app-changed.ts`. A manual *Run workflow*
always benches.

## What one bench run measures

`scripts/perf/bench.cjs` launches the production build cold, with a fresh profile, an offline
fixture ad-filter engine (built by the app's own adblock module, so no list downloads) and a local
fixture site, then:

| metric | how |
|---|---|
| main JS at startup, main JS (all chunks), preload, renderer JS at startup, renderer JS (all assets), renderer CSS | file sizes in `out/` (main "at startup" = `index.js`, its static imports and its top-level `await import()` of the app; renderer "at startup" = the scripts and modulepreloads `index.html` loads) |
| packaged app payload, files in app.asar | what electron-builder packs into `app.asar`, approximated: `build.files` plus the production `dependencies` closure from `node_modules`, minus the `build.files` `!` patterns (`scripts/perf/app-payload.ts`). Renderer-only packages belong in `devDependencies`: Vite bundles them, and in `dependencies` they ship again as raw `node_modules` |
| cold start to window / first paint | process start to the first window, and to the New Tab page's first contentful paint |
| main process JS load | time to `import()` `out/main/index.js` (parse, compile and evaluate the main bundle; best of the runs) |
| IPC during startup | every `ipcMain.handle`/`on` call and `webContents.send` until the first page has loaded |
| memory at 1 / 10 / 30 tabs, GPU process memory, process count | sum over all Surffish processes: PSS on Linux, working set on macOS |
| IPC messages / payload opening 20 tabs | count and JSON size of every IPC message while tabs 11–30 open |
| main CPU opening 20 tabs | main process CPU time over the same window |
| idle IPC, idle main-process timer fires, background tab CPU, main CPU | 5 s idle with 30 tabs open (29 in the background) |
| tab switch | activate → view attached → two frames painted in the tab (median of 12); main-thread CPU per switch and the longest main-thread block go in the responsiveness table |
| keyboard tab switch, close tab, pointer over a page | see *Responsiveness* below |
| new site tab first paint, New Tab page shown | create → first contentful paint (median of 5); blank tab → New Tab page painted (median of 3) |
| processes / webContents left, memory growth after window cycles | open and close a second window 3 times; anything left behind is a leak. Both memory samples follow a forced major GC and a critical memory-pressure notification in every app-UI renderer (`HeapProfiler.collectGarbage`, `Memory.simulatePressureNotification`), so memory that is only waiting to be reclaimed (a closed window's documents and caches in a renderer shared with other windows) doesn't count as growth; the unreclaimed number is in the sample as `windowCycles.memGrowthBeforeGcMB` |
| renderers hosting 16 tabs over 4 sites, memory of those renderers | 16 tabs on `site0..3.localhost` (separate sites to Chromium): distinct processes hosting their pages and iframes, and those processes' memory |
| ad-filter CSS + scriptlets sent per navigation, frame-start main time, DOM-update IPC, injections on same-document navigations | 4 navigations to `video.localhost`, which the fixture engine gives site CSS, 300+ generic rules and 18 scriptlets sharing uBO-style helpers: size of the frame-start payloads, main-process time answering them, frame-update IPCs, then `pushState`/hash changes (must inject nothing) |

The tab counts, idle window and cycle count are in `perf.config.json` → `bench` (trim `tabsMax`
if the job gets too slow).

## Responsiveness

A third table ("Responsiveness during tab operations", warn-only) is about what a user feels while
using tabs rather than totals: hitches in the main (UI) thread, which every window's input, IPC and
paint scheduling waits behind, and in the shell renderers that draw the toolbar and sidebar.

| metric | how |
|---|---|
| main-thread CPU per tab switch | CPU of the browser process's UI thread (`process.threadCpuUsage()`, µs resolution) over the 12 API switches, per switch. That thread runs the app's JS, IPC and view work, and input waits behind it; compositor and IO threads are left out because they swung 31–54 ms per switch on identical code on the pods |
| longest main-thread block, switching / opening 20 tabs / closing; long tasks opening 20 tabs | a 10 ms tick on the unpatched `setTimeout` in main runs only while a phase is measured (never in idle); how late a tick fires is how long the thread was busy, JS or native. Over 50 ms counts as a long task, like the renderer's Long Tasks API. Per-phase `loop.{maxBlockMs,longTasks,blockedMs}` (blocked = total blocking time) are in every sample, also for new tabs, pointer and window cycles |
| keyboard tab switch, key to painted | Ctrl/Cmd+1..3 sent to the page with `sendInputEvent` (the app's `before-input-event` shortcut path), 5 switches over three tabs: keystroke → view attached → two frames |
| main-thread CPU leaving a tab you were reading | the same keyboard switches, with `SURFFISH_WAKE_SNAPSHOT_MIN_SHOWN_MS=0` set by the bench for that step so every outgoing tab counts as read (wake snapshot kept, as after 1.5 s on screen), and 420 ms between keys so the deferred snapshot encode lands inside the switch that caused it. This is the full cost of switching away: capture, overview thumbnail, wake snapshot |
| close tab to next tab painted, main-thread CPU per tab close | the 8 tabs the new-tab step opened, closed one by one (each close activates the next tab): close → two frames in whatever is on screen |
| main-thread CPU for 48 mouse moves and wheel scrolls over a page | `sendInputEvent` mouse moves with a wheel scroll every 4th event over the active page, 8 ms apart; every mouse event a page gets also reaches main (`before-mouse-event`: sidebar edge reveal, popover dismiss) |
| shell long frames / blocking time during tab operations | a Long Animation Frames observer in each shell renderer (toolbar, sidebar, content), installed after start-up; frames with blocking time (tasks over 50 ms) during opening, switching (both kinds), new tabs and closing. No rAF loop, so it costs the renderers nothing between long frames. A long frame without blocking time is a hidden or throttled surface waiting to draw and doesn't count |
| hang check: longest main-thread block, any phase; long tasks, all phases | the maximum over every monitored phase after start-up; the sample's `hang.phase` names where it was |

Synthetic input is sent from the main process, so a main-thread block delays the bench's own
`sendInputEvent` too: the input-to-paint numbers cover the path after main, and main-thread blocks
are what real input would wait behind on top of that. These rows are warn-only until they have
been steady on the pods over a few weeks.

## Cold start by phase

Every run also breaks the cold start into phases, shown as a second table ("Cold start by phase",
warn-only) in the step summary and the sticky comment. Each value is ms from process start to that
point, best of the runs, with the bench's own profile seeding cut out (like the first-paint metric):

| phase | where it comes from |
|---|---|
| main JS loaded | the bench's `import()` of `out/main/index.js` resolving (boot entry + app evaluated) |
| Electron ready | the app `ready` event (fires after the main JS has loaded) |
| profile ready, first window created | `traceStartup()` marks in `src/main/index.ts` |
| toolbar rendered | the toolbar renderer's `surffish:first-commit` user-timing mark (`src/renderer/src/main.tsx`). The toolbar sits hidden behind the New Tab page, which draws its own bar, so it never paints at start-up; its first React commit is when it is ready to show |
| toolbar JS start-up inside its renderer | the same mark relative to the toolbar's own navigation start: fetch, compile and run of the shell bundle plus the first render, without process-launch noise |
| first tab (New Tab page) loaded | the content surface's `load` event (its first paint is "cold start to first paint" in the main table) |
| first window painted, ad filter ready, extensions ready | the deferred start-up marks (`afterFirstWindowPaint`, then the ad-filter engine and Web Store extensions; page requests are released at the last one) |
| warm start: toolbar rendered / first paint | `warmStarts` (2) start-up-only launches per side on the profile the warm-up launch left behind, so the renderer's V8 code cache, the HTTP cache and the window state are warm, like a returning user's. They run after the measured runs, interleaved, when the pod's first-launch costs are long paid |

The main-process marks are recorded by `traceStartup()` (`src/main/startup-defer.ts`) into
`globalThis.__surffishStartupMarks` on every launch (a few `Date.now()` calls); `SURFFISH_STARTUP_TRACE=1`
also prints them. A build without the marks (a base from before they existed) shows `–`. Phase
metrics are `"warnOnly": true` in `perf.config.json`: they warn above their margins and never fail,
on any platform, until their noise on the pods is known. Warm starts add ~1 s per launch (~5 s per job).

**Chrome trace (opt-in, local).** `bun run perf --trace <dir>` records one `contentTracing` trace per
app (first measured run, app ready → deferred start-up done) as `<dir>/<label>-startup-trace.json`, for
https://ui.perfetto.dev. `PERF_TRACE=<file>` does the same for a single bench launch. CI doesn't trace.

Since perf pass 3 `out/main/index.js` is a tiny boot entry: it turns on Node's on-disk compile cache
(`module.enableCompileCache`, in the OS cache dir under `Surffish/node-compile-cache`) and then imports the
app, so every launch after the first skips compiling the ~1 MB main bundle. `SURFFISH_NO_COMPILE_CACHE=1`
turns it off. The bench's warm-up launch fills the cache, so the measured runs are warm, like a returning user.

## Thresholds

All in `scripts/perf/perf.config.json`. A change only counts when it is worse than main by more
than **both** the metric's percentage and its absolute floor `abs` (in the metric's raw unit:
bytes for KB metrics, ms, MB, or a count), so 0 → 1 idle messages or 3 ms of tab-switch jitter
never trips anything.

| kind | metrics | rule |
|---|---|---|
| deterministic | bundle sizes, startup IPC count, idle IPC and timer fires, process count | **fail** above 5% (+ floor) |
| leak | processes / webContents left after window cycles | **fail** on any growth that main doesn't have |
| noisy | timings, memory, CPU, IPC while opening tabs | **warn** above 10%, **fail** above 25% (+ floor) on Linux (IPC while opening tabs 20% / payload 15%); never fail on macOS. GPU process memory only warns on Linux too |

**Confirmation pass (Linux).** When the only failures are noisy metrics (compare.ts exits 3), the job
benches both builds again, interleaved, pools the samples with the first pass (`scripts/perf/merge.ts`)
and judges the pooled numbers. A real regression is there in both passes; a busy stretch on the node
is not. It costs ~2 min, only on those runs. Deterministic or leak failures fail straight away.

IPC while opening tabs is timing-dependent (tab/state broadcasts are coalesced per frame): 115–151
messages and 59–76 KB on identical code in Oct 2026, so it is a noisy metric. GPU process memory
under SwiftShader is bimodal on the pods (~57–61 MB or ~92–103 MB on identical code), so on Linux it
only warns; the Mac job is where it means something.

Cold start to window / first paint compare the **best** of the runs (`"stat": "min"`), not the
median: the pods share a node with the smoke lanes, and a busy moment stalls one or two cold starts by
0.5–3 s on identical code (277 ms → 1411 ms on main once). Noise only ever adds to a start-up time,
while a slower build is slower in every run, so the minimum still moves with a real regression. Before
the measured runs, each side gets one discarded start-up-only launch (`warmup` in the config,
`PERF_WARMUP` or `--warmup N`): the first Electron launch on a fresh pod also builds the font and
shader caches.

Metrics marked `"warnOnly": true` never fail on any platform (a would-be failure shows as a warning).
New metrics start that way until a few weeks of CI show how much they move on identical code:
currently the start-up phases, responsiveness, mixed-sites and ad-filter cosmetics rows.

Improvements past the same margins show as "better". Per-metric overrides go on the metric entry
(`"failPct"`, `"warnPct"`, `"abs"`); per-platform behaviour under `platforms`.

## Run it locally

```sh
bun run build
bun run perf                       # 3 runs of this checkout, prints medians
# compare against another built checkout (e.g. a worktree of main):
bun run perf --app main=../surffish-main --app pr=. --runs 3 --out perf.json
bun run perf:compare perf.json --base main --head pr
bun run test:perf                  # unit tests for the comparison logic
```

On headless Linux wrap the run in `xvfb-run -a`. Close other heavy apps first; timing numbers on a
busy laptop are only good for spotting big changes.

## CI settings

- `PERF_RUNS` (job env, default 3): runs per side. Each run is ~20–30 s on the Linux pods.
- `PERF_WARM_STARTS` (default `warmStarts` in the config, 2): warm-profile start-up launches per side; 0 turns them off.
- `SURFFISH_GH_PROXY` (Mac runner `.env`, optional), e.g. `socks5h://127.0.0.1:1080`. The Mac
  runner's network blocks non-enterprise GitHub API calls, so by default its results only go to
  the step summary. With this set, the job passes it to `curl --proxy` for the comment calls only
  (nothing else in the job uses the proxy) and posts a separate sticky "Perf check (macOS)" comment.
  If the variable is unset or the call fails, the job just logs a warning. The job also logs
  whether the variable is present and the HTTP status of a `GET /repos/…` through it.
- `perf-mac` (PR label): runs `perf (macos)` on that PR. Labels are read when a run starts, so
  push a commit (or re-open the PR) after adding it; *Run workflow* also runs it, against `main`.
- `SURFFISH_MAC_CI` (repo variable, optional): set to `label` to run `macos smoke` on PRs only when
  they carry the `mac` label (pushes to `main` always run).
- The comment uses the job's `GITHUB_TOKEN` with `pull-requests: write`; a failed post never fails
  the job. Fork PRs don't run CI on these runners at all.

## Bun only, no Node.js in CI

The Mac runner is a managed laptop whose endpoint protection flagged Node.js spawned by Bun
lifecycle scripts (electron's `install-electron`). Every CI job therefore:

- runs `scripts/ci/bun-as-node.sh` right after installing Bun: it takes the runner's own
  `externals/node*` directories off `PATH`, puts a `node` → `bun` symlink first, and fails unless
  `node` resolves to that shim, so `#!/usr/bin/env node` tools (electron's `cli.js` and
  `install-electron`, electron-vite) run under Bun's Node compatibility mode;
- runs `bun install` through `scripts/ci/watch-node.sh`, which samples the process table during
  the install and fails if any real Node.js process shows up (the log says so either way);
- on the Mac runs `bun install` through `scripts/ci/bun-install-mac.sh`. The runner's `.env` points
  `HTTP(S)_PROXY` at a `socks5://` proxy, which Bun can't use (`UnsupportedProxyProtocol downloading
  tarball …` for any package not already installed), so the script drops a SOCKS proxy for bun only;
  the runner's network reaches the npm registry and Electron's downloads directly. When the Electron
  pin changes, the root `postinstall` (`install-electron`, under the bun shim) fetches that version's
  binary once into `node_modules/electron/dist` (the `electronDist` release builds package from). The
  script then checks the binary is there for the locked version and fails otherwise, because Electron
  45+ downloads a missing binary lazily on the first `require('electron')`. No other step downloads
  Electron, and there is still never a second `bun install` on the Mac.

The perf bench launches the Electron binary directly (`require('electron')`), not through the
`.bin/electron` wrapper. A repo-wide `bunfig.toml` `[run] bun = true` was left out on purpose: it
would also change how local `bun run dev` executes tools.

## Limits

- The base is built with the PR's bench script, so a PR that changes the bench changes both sides.
- On macOS the base reuses the PR's native addons (trackpad swipe, Google sign-in helper), so
  native code changes aren't measured.
- The fixture ad-filter engine is tiny, so the real filter lists' memory and parse time aren't in
  the numbers. Set `PERF_ADBLOCK_ENGINE=/path/to/adblock-engine-v2.bin` to seed a real one.
- Linux has no GPU; the Mac job is where GPU memory and real compositing show up. Memory-pressure
  tab discard and native sidebar blur aren't exercised by the bench yet.
- Tried and not adopted (Oct 2026): a V8 code cache for the browser chrome. Chromium never code-caches
  `file://` scripts, so the shell was served from a `codeCache` custom scheme with
  `v8CacheOptions: 'bypassHeatCheck'` (and `…AndEagerCompile`). Traces showed the cache hit (170 KB
  consumed for the main bundle, not rejected), but toolbar and first-paint times were no better than
  `file://`, which streams and compiles scripts off the main thread and needs no main-process round
  trip per file (warm toolbar commit inside its renderer: 150 ms best / 195 ms median on `file://`
  vs 160 / 201 ms with the cache, 30 launches each). Most of the renderer's compile time is lazy
  functions the cache doesn't hold.
