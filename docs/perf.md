# Perf check

Every PR gets a perf comparison against its base: CI builds both, runs the same bench on each
(interleaved, on the same machine), and compares medians. Deterministic metrics fail the check
on a regression; timing and memory metrics mostly warn, because shared runners are noisy.

- `perf (linux)`: k3s runner pod under xvfb (software rendering, ~2 vCPU). Writes the table to
  the job's step summary and keeps one sticky PR comment up to date.
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

## What one bench run measures

`scripts/perf/bench.cjs` launches the production build cold, with a fresh profile, an offline
fixture ad-filter engine (built by the app's own adblock module, so no list downloads) and a local
fixture site, then:

| metric | how |
|---|---|
| main bundle, main JS (all chunks), preload, renderer JS at startup, renderer JS (all assets), renderer CSS | file sizes in `out/` ("at startup" = the scripts and modulepreloads `index.html` loads) |
| cold start to window / first paint | process start to the first window, and to the New Tab page's first contentful paint |
| IPC during startup | every `ipcMain.handle`/`on` call and `webContents.send` until the first page has loaded |
| memory at 1 / 10 / 30 tabs, GPU process memory, process count | sum over all Surffish processes: PSS on Linux, working set on macOS |
| IPC messages / payload opening 20 tabs | count and JSON size of every IPC message while tabs 11–30 open |
| main CPU opening 20 tabs | main process CPU time over the same window |
| idle IPC, idle main-process timer fires, background tab CPU, main CPU | 5 s idle with 30 tabs open (29 in the background) |
| tab switch | activate → view attached → two frames painted in the tab (median of 12) |
| new site tab first paint, New Tab page shown | create → first contentful paint (median of 5); blank tab → New Tab page painted (median of 3) |
| processes / webContents left, memory growth after window cycles | open and close a second window 3 times; anything left behind is a leak |

The tab counts, idle window and cycle count are in `perf.config.json` → `bench` (trim `tabsMax`
if the job gets too slow).

## Thresholds

All in `scripts/perf/perf.config.json`. A change only counts when it is worse than main by more
than **both** the metric's percentage and its absolute floor `abs` (in the metric's raw unit:
bytes for KB metrics, ms, MB, or a count), so 0 → 1 idle messages or 3 ms of tab-switch jitter
never trips anything.

| kind | metrics | rule |
|---|---|---|
| deterministic | bundle sizes, IPC counts and payload, idle IPC and timer fires, process count | **fail** above 5% (+ floor); IPC while opening tabs 20% / payload 15%, since tab broadcasts are coalesced per frame and move ~10% run to run |
| leak | processes / webContents left after window cycles | **fail** on any growth that main doesn't have |
| noisy | timings, memory, CPU | **warn** above 10%, **fail** above 25% (+ floor) on Linux; never fail on macOS |

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
- on the Mac also sets `ELECTRON_SKIP_BINARY_DOWNLOAD=1`. Electron 44's `install.js` doesn't read
  it; what keeps it from downloading is that `node_modules/electron/dist` is already installed on
  the persistent runner (the same `electronDist` that release builds package from).

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
