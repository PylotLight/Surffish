# Surffish CEF + Bramble + adblock POC

**Recommendation: no-go for replacing Electron now.** The POC proves that CEF 156 can start in Chrome runtime style, load Surffish’s adapted Bramble Firefox 1.35.0 bundle, and let Ghostery’s core block a real uBlock rule on a page request. That is a useful feasibility result, but it does not outweigh CEF’s much larger runtime, three Chromium majors of lag versus Surffish’s current Electron alpha, an unsupported-by-public-CEF-API extension-loading route, and untested macOS/Windows packaging. Revisit only after a stable CEF build includes the M158 extension-worker fix and a production-supported extension-loading story.

Everything in this directory is an isolated experiment. It does not change Surffish’s production Electron host, filter policy, or Bramble adapter.

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

The official CEF 156 Linux x64 minimal archive is 333,362,327 bytes (SHA-1 `1ccade9535dba5362f0c6adb05f9ae019e860af1`). Its uncompressed contents were about 1.60 GB; the built CEF `Release` tree measured 1.5 GB. The exact Electron 46.0.0-alpha.8 Linux distribution measured 284 MB, with an npm binary archive of 129,755,550 bytes. So this CEF archive was 2.57× larger to download and its built runtime tree about 5.4× larger than Electron’s `dist` tree.

On the same local-page/Brambler/live-filter fixture, CEF’s browser process tree peaked at 939.9 MiB plus 73.8 MiB for its separate Ghostery broker (about 1,014 MiB total); Electron’s app/browser tree peaked at 706.5 MiB. That is about 44% more for this one run. These are rough Linux smoke-test peaks, not product benchmarks; the CEF broker is a separate process while Electron’s blocker ran in the Electron process tree.

Only Linux x64 was built and tested. No macOS ARM or Windows CEF build, secure Chromium sandbox, installer/package integration or release-signing path was tested. The sandbox smoke run used `xvfb-run` and `--no-sandbox`; the build emitted the separate `chrome-sandbox` SUID setup instruction. CEF requires platform-specific builds/resources and a lower-level native host, so the Linux result does not establish an acceptable Mac or Windows burden. The latest official CEF build checked was Chromium 156.0.8078.88; Electron 46.0.0-alpha.8 measured Chromium 159.0.8140.0, and the official CEF index had no Chromium 159 Linux x64 build.

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

## Test status

`bun check` passed with no type errors in 795 files. The focused Ghostery adapter, existing adblock, Bramble staging/release and worker-bridge suites passed: 49 tests, 0 failures. The native CEF 156 minimal target built successfully. Both live-engine smoke runners passed their page, message and storage assertions; the CEF worker-handler and `Origin` caveats above are deliberately reported, not treated as compatibility passes.
