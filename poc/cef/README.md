# Surffish CEF + Bramble + adblock POC

**Recommendation: no-go for replacing Electron now.** The POC proves that CEF 156 can start in Chrome runtime style, load Surffish’s adapted Bramble Firefox 1.35.0 bundle, and let Ghostery’s core block a real uBlock rule on a page request. That is a useful feasibility result, but it does not outweigh CEF’s much larger runtime, three Chromium majors of lag versus Surffish’s current Electron alpha, an unsupported-by-public-CEF-API extension-loading route, and untested macOS/Windows packaging. Revisit only after a stable CEF build includes the M158 extension-worker fix and a production-supported extension-loading story.

Everything in this directory is an isolated experiment. It does not change Surffish’s production Electron host, filter policy, or Bramble adapter.

## Newer CEF prerelease availability

The official [CEF build index](https://cef-builds.spotifycdn.com/index.json) currently lists stable and beta builds, but no alpha channel and no Linux x64 build on Chromium 159. The newest Linux64 beta entry is CEF 156.0.7 / Chromium 156.0.8078.17, older than this POC’s previously checksum-verified stable CEF 156.0.27 / Chromium 156.0.8078.88. There was no newer official CEF alpha to test, so the measurements below use the existing stable build rather than downgrading to that beta.

The CEF 156 public headers still expose no `LoadExtension` or `CefExtensionHandler` install API. Bramble continues to load through Chromium’s `--load-extension` switch; the worker/API smoke is useful subset evidence, not a supported extension-host contract or full extension parity.

## What was tested

The adblock target is the one already selected by Surffish in [`src/main/adblock-policy.ts`](../../src/main/adblock-policy.ts): Ghostery’s `@ghostery/adblocker` engine (used in production through `@ghostery/adblocker-electron`) with the full desktop uBO-style configuration. The ten configured sources are uBlock filters, badware, privacy, unbreak, quick fixes and resource abuse; EasyList and EasyPrivacy; Peter Lowe’s list; and URLhaus. The POC downloaded and compiled all ten with no failures. The generated engine was 16,398,869 bytes. Its live `doubleclick.net` match was `||doubleclick.net^`.

The Bramble target is the Firefox Manifest V3/module-service-worker build selected by [`src/main/bramble-poc.ts`](../../src/main/bramble-poc.ts) and adapted by [`src/main/bramble-poc-adapter.ts`](../../src/main/bramble-poc-adapter.ts), not a different password manager or a guessed Chrome Store package. The current stable Firefox asset is Bramble 1.35.0, `bramble_firefox_1.35.0.zip`, SHA256 `62d619c7f5ef9d0d635546bf4756237b8fb7570b634822fe5ff53258cb87bb84`. It was downloaded from the current official [`bramble-sh/bramble` releases](https://github.com/bramble-sh/bramble/releases) and verified against its published `SHA256SUMS` and GitHub asset digest. The test copy was staged through Surffish’s production adapter, then instrumented only in a disposable `/tmp` copy.

One source-repository wrinkle was found: GitHub now lists the release assets under `bramble-sh/bramble`, while [`src/main/bramble-release.ts`](../../src/main/bramble-release.ts) still hard-codes `flythenimbus/bramble` and validates that old asset path. The production code was left unchanged. [`stage-bramble.mjs`](./stage-bramble.mjs) uses the current canonical repository and reuses Surffish’s checksum-verifying download and safe extraction functions; this keeps the POC usable without disguising that existing path mismatch.

## Results and caveats

- **Startup and extension subset: pass on Linux x64.** The official `cef-project` minimal host built and launched with CEF 156. Chrome runtime style was explicitly selected. The adapted Bramble module worker imported, received a content-script `runtime.sendMessage`, replied successfully, and read `storage.local`. These checks show basic MV3 plumbing, not full Bramble UI, autofill, passkey, popup, OAuth or desktop-link behavior.
- **Missing/optional APIs:** the worker probe found `identity` and `runtime.connectNative` unavailable. Surffish already removes Bramble’s optional `identity` permission because that API is only used for its optional Google Drive OAuth backup. The extension’s optional native-messaging desktop-link path was not made to work here; it was also absent in the bare Electron comparison. `alarms`, `idle`, `offscreen`, `windows`, storage and runtime messaging were present or supplied by the staged Surffish compatibility alias, but only messaging and storage read were exercised.
- **Network filtering: pass for page subresources.** With the live production engine, CEF’s `OnBeforeResourceLoad` path blocked a `<script>` request to `doubleclick.net` and allowed a control script. The Electron 46 baseline using Surffish’s actual `ElectronBlocker` wrapper passed the same page fixture. The CEF implementation is only a network-rule adapter: it does not implement Surffish’s cosmetics, scriptlets, CSP handling or the full Electron wrapper. The deterministic adapter tests separately cover a synthetic rule and a site-specific exception.
- **Extension-worker request caveat:** Bramble’s cross-origin service-worker fetch reached a local CORS echo endpoint in both test hosts. The endpoint observed `Origin: null` in CEF and in the bare Electron harness. In CEF, that worker fetch did **not** appear in the POC’s CEF resource-handler log, so this adapter did not filter it. This result is not a CEF-only comparison: the extension was Surffish’s adapted Firefox bundle, and the Electron harness was not stock Chrome. CEF issue [#4309](https://github.com/chromiumembedded/cef/issues/4309) documents the synthetic `Origin: null` behavior and a fix assigned to M158; the tested CEF 156 build predates that fix. The issue’s fix and reported Chrome comparison make this an important retest item, but this POC does not establish that Bramble itself fails or that Electron is unaffected. CEF issue [#3593](https://github.com/chromiumembedded/cef/issues/3593) was closed for M154, yet the Bramble extension-worker request still did not reach this handler in our test.
- **Extension loading is fragile.** The test used Chromium’s `--load-extension` switch, which worked with this build. CEF 156’s public headers do not expose a `LoadExtension`/`CefExtensionHandler` API. CEF’s [extension discussion](https://github.com/chromiumembedded/cef/issues/3685) limits extension APIs to Chrome runtime style; the [runtime-style docs](https://cef-builds.spotifycdn.com/docs/156.0/cef__types__runtime_8h.html) describe Chrome style as the Chrome UI layer and require setting it per window/browser. This is not proof of a stable, supported extension host contract.
- **Adapter bridge is a prototype.** CEF’s [request-handler API](https://cef-builds.spotifycdn.com/docs/156.0/classCefResourceRequestHandler.html) calls `OnBeforeResourceLoad` on the IO thread and documents null browser/frame values for service-worker requests; it also supports asynchronous continuation. This POC instead blocks on a Unix-domain-socket call to a Bun Ghostery broker, with a timeout. That is a feasibility bridge, not a production threading or failure-handling design.

## Size, memory and platform burden

The official CEF 156 Linux x64 minimal archive is 333,362,327 bytes (SHA-1 `1ccade9535dba5362f0c6adb05f9ae019e860af1`). Its built `Release` runtime tree measured 1,587,971,393 apparent bytes and 1,588,785,152 allocated bytes; Electron 46.0.0-alpha.8’s `dist` tree measured 297,612,871 apparent bytes and 297,775,104 allocated bytes. The extracted trees were on `/dev/shm` tmpfs, so allocated blocks describe that test filesystem, not persistent SSD usage; apparent bytes are the clearer runtime payload comparison. The CEF archive was 2.57× larger to download and its runtime tree about 5.34× larger by either byte measure. The Electron npm binary archive was 129,755,550 bytes.

Four fresh-process trials per host ran in alternating order against the same local page, Bramble 1.35.0 test copy, and identical 16,398,869-byte ten-list Ghostery engine (SHA-256 `f35d43babd95316a765c32712bf8409ca9d2c8c9fabdd62e2a45aac768205d9d`). The page first waited idle for three seconds, then ran a three-second JavaScript busy loop. Values below are median with min–max across the four runs:

| Metric                                |                                             CEF 156.0.27 |                                  Electron 46.0.0-alpha.8 |
| ------------------------------------- | -------------------------------------------------------: | -------------------------------------------------------: |
| Cold process launch to validated page |                                         712 ms (690–729) |                                         758 ms (712–766) |
| Idle CPU over 3 s                     |             186 ms; 6.2% of one core (175–196; 5.8–6.5%) |             131 ms; 4.4% of one core (126–144; 4.2–4.8%) |
| Idle mean RSS                         |                                  1,021 MiB (1,020–1,022) |                                        756 MiB (754–756) |
| Active CPU over 3 s                   | 3,046 ms; 101.4% of one core (3,036–3,058; 101.0–101.8%) | 3,049 ms; 101.6% of one core (3,022–3,067; 100.6–102.1%) |
| Active mean RSS                       |                                  1,032 MiB (1,031–1,033) |                                        762 MiB (760–762) |
| Peak summed process-tree RSS          |                                  1,033 MiB (1,031–1,034) |                                        763 MiB (762–764) |

This is a controlled Linux smoke evaluation, not an app benchmark: the host was an 8-logical-CPU Intel Xeon VM at 2.50 GHz with 23.64 GiB RAM, running Linux 6.18.38; both apps used Xvfb and `--no-sandbox`, and the OS file cache was not flushed. CPU ticks and summed RSS were sampled every 125 ms across each test process tree (including the POC runner; CEF’s Ghostery broker is in that runner). RSS can count shared mappings more than once. The active workload is deliberately synthetic; its near-100% one-core result mainly confirms that both engines ran the same busy loop. The small startup difference is not persuasive because the ranges overlap. CEF used more idle CPU and roughly 265 MiB more idle RSS in this fixture, but RSS overstates the physical-memory gap; the normalized PSS follow-up below puts the difference near 99–104 MiB.

Both hosts passed the actual page-filter assertions and Bramble’s tested module-worker import, runtime messaging, and storage read. CEF still allowed Bramble’s cross-origin worker fetch to reach the local echo endpoint with `Origin: null`, but that fetch did not appear in the CEF request-handler log. The API probe also reported `identity` and `runtime.connectNative` unavailable; popup, autofill, passkeys, OAuth, native messaging, and full Bramble UI were not tested. A fresh filter-list rebuild was attempted twice, but the selected URLhaus host closed the connection; to preserve a true ten-list A/B workload, both runs reused the same earlier all-ten-list engine instead of using the new partial nine-list build. The result JSON records the engine hash and raw trials.

### Normalized runtime package and memory check

To separate deployment payload from debug-symbol and locale baggage, the same CEF and Electron runtime builds were staged with ELF `.debug_*` sections removed and only `en-US.pak` retained. Each amd64 Debian test package included the identical 16,398,869-byte ten-list Ghostery engine (SHA-256 `f35d43babd95316a765c32712bf8409ca9d2c8c9fabdd62e2a45aac768205d9d`) and the same 83-file Bramble probe. Both used `dpkg-deb` with xz level 6. These are runtime-only test packages, not complete Surffish installers; they were smoke-tested from their staging trees but not installed.

| Measure                                                   |                           CEF 156.0.27 |       Electron 46.0.0-alpha.8 |
| --------------------------------------------------------- | -------------------------------------: | ----------------------------: |
| Staged runtime payload                                    |          519,462,896 bytes (495.4 MiB) | 288,028,101 bytes (274.7 MiB) |
| Compressed `.deb` with identical engine and Bramble probe |         132,691,716 bytes (126.54 MiB) | 101,239,444 bytes (96.55 MiB) |
| Idle mean process-tree PSS                                |                464.6 MiB (462.6–465.1) |       365.8 MiB (365.3–366.8) |
| Active mean process-tree PSS                              |                471.1 MiB (469.6–472.0) |       367.5 MiB (366.4–368.4) |
| Idle CPU, separate PSS-disabled pass                      | 180.3 ms / 6.0% of one core (5.8–6.4%) |    137.6 ms / 4.6% (4.2–5.1%) |
| Active CPU, same synthetic 3-second busy loop             |          3,062 ms / 101.9% of one core |             3,045 ms / 101.4% |

The raw unstripped runtime-tree gap was 5.34×; after removing 968.2 MiB of CEF debug sections (versus 0.8 MiB for Electron) and trimming locales, it was 1.80×. The compressed test-package gap was 1.31×. CEF still used about 99 MiB more idle process-tree PSS and 104 MiB more active PSS; summed RSS exaggerates that difference because it double-counts shared mappings. PSS was sampled from `smaps_rollup` every 500 ms; any PSS peak in the raw results is therefore a sampled maximum, not a guaranteed instantaneous peak. CPU was measured in a separate pass with PSS disabled because frequent PSS reads can perturb the harness CPU result. Four fresh-process runs per host were used for each profile, and all 16 smoke runs passed the page-filter and Bramble-probe assertions.

The cgroup v2 `memory.current` data is retained in the result JSON, but the sandbox exposed only a shared service cgroup, not a private benchmark cgroup; those readings cannot be attributed to the browser process trees and are diagnostic only. Both profiles ran on Linux x64 under Xvfb with `--no-sandbox`, and the active workload is synthetic. Full application dependencies, installers, secure sandbox setup, and macOS/Windows deployment remain untested. See [`deployment-comparison.json`](./deployment-comparison.json) for the raw trials and packaging details.

Only Linux x64 was built and tested. No macOS ARM or Windows CEF build, secure Chromium sandbox, installer/package integration or release-signing path was tested. The sandbox smoke run used `xvfb-run` and `--no-sandbox`; the build emitted the separate `chrome-sandbox` SUID setup instruction. CEF requires platform-specific builds/resources and a lower-level native host, so the Linux result does not establish an acceptable Mac or Windows burden. Electron measured Chromium 159.0.8140.0; the checked CEF index had no Linux x64 build on Chromium 159.

## Reproduce

On Linux x64, install the CEF 156 minimal archive listed in the [official CEF build index](https://cef-builds.spotifycdn.com/index.json), verify its SHA-1 above, and extract it. Then build the isolated native host:

```sh
CEF_ROOT=/path/to/cef_binary_156.0.27+ga10dae3+chromium-156.0.8078.88_linux64_minimal \
  bash poc/cef/prepare-cef-project.sh
cmake -S /tmp/surffish-cef-project -B /tmp/surffish-cef-build \
  -G 'Unix Makefiles' -DCMAKE_BUILD_TYPE=Release -DWITH_EXAMPLES=ON
cmake --build /tmp/surffish-cef-build --target minimal --parallel 4
```

Stage and instrument the latest verified Bramble Firefox release, compile the current configured filter sources, then run the CEF fixture:

```sh
bun poc/cef/stage-bramble.mjs /tmp/bramble-staged
bun poc/cef/prepare-bramble-probe.mjs /tmp/bramble-staged /tmp/bramble-probe
bun poc/cef/build-live-filter-engine.mjs /tmp/surffish-production-engine.bin

CEF_POC_BINARY=/tmp/surffish-cef-build/Release/minimal \
CEF_POC_ENGINE_FILE=/tmp/surffish-production-engine.bin \
CEF_POC_BLOCK_HOST=doubleclick.net \
CEF_POC_EXTENSION_PATH=/tmp/bramble-probe \
  bun poc/cef/run-adblock-smoke.mjs
```

`run-electron-smoke.mjs` is the matching Electron baseline. It requires `ELECTRON_POC_BINARY`, and accepts the same engine and staged extension through `ELECTRON_POC_ENGINE_FILE` and `ELECTRON_POC_EXTENSION_PATH`. The live filter lists can change over time; the synthetic fixture tests remain deterministic. The CEF runner requires `xvfb-run` and uses `--no-sandbox`, so it is not a secure production launch recipe.

For the repeated comparison, set both hosts’ engine variables to the same serialized engine and both extension variables to the same staged probe directory, then run:

```sh
SURFFISH_POC_BENCH_REPEATS=4 \
SURFFISH_POC_BENCH_IDLE_MS=3000 \
SURFFISH_POC_BENCH_ACTIVE_MS=3000 \
CEF_POC_BINARY=/path/to/cef-build/Release/minimal \
CEF_POC_RUNTIME_DIR=/path/to/cef-build/Release \
CEF_POC_ENGINE_FILE=/path/to/production-engine.bin \
CEF_POC_EXTENSION_PATH=/path/to/bramble-probe \
CEF_POC_BLOCK_HOST=doubleclick.net \
ELECTRON_POC_BINARY=/path/to/electron/dist/electron \
ELECTRON_POC_ENGINE_FILE=/path/to/production-engine.bin \
ELECTRON_POC_EXTENSION_PATH=/path/to/bramble-probe \
ELECTRON_POC_BLOCK_HOST=doubleclick.net \
  bun poc/cef/run-benchmarks.mjs
```

The default output is `poc/cef/benchmark-results.json`; set `SURFFISH_POC_BENCH_OUTPUT` to choose another path. The runner alternates which host goes first and refuses mismatched engine or extension inputs.

For the normalized runtime-only package and memory comparison, prepare the same CEF and Electron runtime trees, the Bramble probe, and the exact ten-list engine recorded above, then run [`run-deployment-comparison.mjs`](./run-deployment-comparison.mjs):

```sh
CEF_POC_RUNTIME_DIR=/path/to/cef/Release \
CEF_POC_BINARY=/path/to/cef/Release/minimal \
ELECTRON_POC_BINARY=/path/to/electron/dist/electron \
CEF_POC_ENGINE_FILE=/path/to/all-ten-list-engine.bin \
CEF_POC_EXTENSION_PATH=/path/to/bramble-probe \
  bun poc/cef/run-deployment-comparison.mjs
```

The script verifies the engine size and SHA-256 against `benchmark-results.json`, packages both runtimes with the same settings, runs separate sparse-PSS and PSS-disabled CPU profiles, and writes [`deployment-comparison.json`](./deployment-comparison.json). Temporary package files are removed by default; set `SURFFISH_POC_DEPLOY_KEEP=1` only to keep scratch artifacts for debugging.

## Test status

`bun check` passed with no type errors in 795 files. The focused Ghostery adapter, existing adblock, Bramble staging/release and worker-bridge suites passed: 49 tests, 0 failures. The native CEF 156 minimal target built successfully. Both live-engine smoke runners passed their page, message and storage assertions; the CEF worker-handler and `Origin` caveats above are deliberately reported, not treated as compatibility passes.
