# macOS builds and releases

Surffish's macOS release runs `bun run release` on an Apple-silicon Mac, either locally or through the manual `release` workflow (Actions → release → Run workflow), which runs the same script on the self-hosted Mac runner and defaults to a dry run. GitHub's hosted macOS minutes are used up, so nothing builds on hosted runners. Release notes for each version go in `docs/releases/vX.Y.Z.md`. Releases ship a zip, not a DMG. The DMGs for v0.1.0 and v0.1.1 opened with "not supported on this Mac", and at about 320 MB each they were more than twice the size of the zip, which is about 117 MB (max deflate, English-only Chromium locales).

## TL;DR: `bun run release`

On an Apple-silicon Mac, on an up-to-date clean `main`:

```bash
bun run release            # patch bump, e.g. 0.1.1 -> 0.1.2
bun run release minor      # or major, or an exact 0.3.0
bun run release current    # package.json already bumped by hand, just ship it
bun run release --dry-run  # build + verify only, publishes nothing (still checks the GitHub API read-only)
```

It works out the next version from the latest `vX.Y.Z` tag and `package.json` (whichever is newer), then:

1. Needs `docs/releases/vX.Y.Z.md`. If that file is missing, it drafts one from the commits since the last tag and stops so you can rewrite it to the [release notes rules](#release-notes) and push it.
2. Bumps `package.json` and commits `chore: release vX.Y.Z` locally.
3. Runs `bun install`, typecheck and tests (`--skip-checks` skips those two), then `dist:mac`, then `unzip -tq`, then the SHA-256.
4. Asks before publishing (`--yes` skips the prompt). If you say no or anything fails, it undoes the bump commit.
5. Pushes main, pushes an annotated `vX.Y.Z` tag, creates the GitHub release with only the zip (REST calls via `curl --proxy "$SURFFISH_GH_PROXY"` with `SURFFISH_GH_TOKEN`/`GITHUB_TOKEN` when `SURFFISH_GH_PROXY` is set, which the release workflow uses on the Mac runner; otherwise through your fish `ghp` function, or plain gh with `SURFFISH_GH=gh`), and renders, commits and pushes `Casks/surffish.rb`. Its git fetch/ls-remote/pushes also go through `SURFFISH_GH_PROXY` when it's set (`git -c http.https://github.com/.proxy=…`, socks5h works).

The manual steps below are what it automates.

## npm launcher (`npx @pylotlight/surffish`)

The release workflow's `npm` job runs after the `mac` job (release + Cask) succeeds, on a GitHub-hosted runner: it stamps `packages/cli` with the released version and the zip's SHA-256, then `npm publish --provenance --access public` through npm trusted publishing (no token). Dry runs do `npm publish --dry-run`. It skips with a warning until the repo variable `NPM_PUBLISH=true` is set; one-time setup in [packages/cli/DEVELOPING.md](../packages/cli/DEVELOPING.md#publishing). `bun run release` run locally doesn't publish to npm.

## Release notes

`docs/releases/vX.Y.Z.md` is published verbatim as the GitHub release body. Start from [docs/releases/TEMPLATE.md](releases/TEMPLATE.md); [docs/releases/v0.1.5.md](releases/v0.1.5.md) is the reference example. The draft `bun run release` writes from commit subjects is only raw material and needs rewriting to these rules:

- **Voice**: neutral, public-facing, third person ("Surffish now…", "Toolbar popovers close on…"). No first person, and never address the maintainer or reader casually ("you", "your", "we"). No asides, jokes or internal shorthand.
- **Intro**: a one-line summary of the headline changes under the `# Surffish vX.Y.Z` title.
- **Sections**, in this order, omitting any that are empty: New, Fixed, Data and storage, Performance, CI, Packaging.
- **Order**: user-facing changes first; internal, test and CI changes terse and at the bottom.
- **Bullets**: bold the feature name in New (`**Feeds**: …`), name menu paths in bold (Settings → **General**), quote extension and product names ("I still don't care about cookies"), and end each bullet with its PR numbers in parentheses (#120) or (#119, #122).

## Mac runner: GitHub route and failure reasons

The self-hosted Mac's network refuses GitHub token writes on the direct route (`git push` gets `Permission to PylotLight/Surffish.git denied to github-actions[bot]`, 403), so git has to go through the local SOCKS proxy. Put this in the runner's `.env` (`~/.actions-runner/.env`) and restart the runner:

```
SURFFISH_GH_PROXY=socks5h://127.0.0.1:1080
```

With it set, every Mac checkout (release, CI, screenshots) sets `http.https://github.com/.proxy` in the work dir, and `release.ts` passes it to its own git calls and REST calls, so it no longer matters whether the runner was started with `HTTP(S)_PROXY` in its env (v0.1.29's first two runs failed at the push because a restart dropped it). Without `SURFFISH_GH_PROXY`, git uses `HTTPS_PROXY` from the env if there, else goes direct.

The release job checks push access before the build: **Preflight - can this runner push to GitHub?** runs `git push --dry-run` of main (sends nothing, but needs write access) through the same route, so a broken route fails in seconds.

Failure-prone steps run through `scripts/ci/explain.sh`, which on failure adds one `::error` annotation and a line in the run summary with a short reason (`scripts/ci/failure-reason.ts`, tested in `failure-reason.test.ts`), e.g.

```
::error title=bun run release::push to GitHub 403: runner not behind proxy (route direct (no proxy)), set SURFFISH_GH_PROXY / HTTPS_PROXY in the runner .env and restart it
```

Known reasons: push/git 403, proxy unreachable, DNS, 401 token, tag already on origin, missing release notes, failed unit test / typecheck, zip/electron-builder, notarization, npm errors, runner offline, timeout. Anything else gets the last error line of the step.

### Seeing the reason in the runner terminal

The runner prints only `Job … completed with result: Failed`. Pipe it through `scripts/runner-watch.ts` (Bun, no dependencies) and it adds the reason under each failed job, looked up from the job's annotations (latest failed job with that name across your repos):

```
2026-10-21 03:24:01Z: Job Surffish · Release · mac build · patch completed with result: Failed
  ↳ why: bun run release: push to GitHub 403: runner not behind proxy (…)  https://github.com/PylotLight/Surffish/actions/runs/…/job/…
```

fish, from the runner dir:

```fish
cd ~/.actions-runner
set -x SURFFISH_GH_PROXY socks5h://127.0.0.1:1080   # optional: API calls through the proxy
./run.sh &| bun ~/path/to/Surffish/scripts/runner-watch.ts
```

(bash/zsh: `./run.sh 2>&1 | bun …`.) Runner lines pass through unchanged; lookups run in the background, so it never holds up or breaks the runner's output, and Ctrl-C still goes to the runner. Auth comes from `GH_TOKEN` / `GITHUB_TOKEN` or `gh auth token` (unauthenticated is fine for public repos). `RUNNER_WATCH_OWNER` (default `PylotLight`) and `RUNNER_WATCH_REPOS` (comma list) narrow the search.

## Builds: ARM64 zip only

Build on an Apple-silicon Mac with Xcode Command Line Tools installed. Surffish's Electron 44 runtime requires macOS Ventura (13) or later. Set `package.json` to the approved version before building. The build also compiles the AppKit trackpad addon and needs Apple's `xcrun`/Clang toolchain.

To test a packaging change without cutting a release, run `bun run dist:mac` on the branch. It builds locally with `--publish never` and does not need or create a Git tag. The packaged app is at `release/mac-arm64/Surffish.app`; `bun run dev` does not run `afterPack` hooks and cannot verify packaged Mach-O changes.

```bash
bun install
bun run typecheck
bun run test
bun run dist:mac
```

`build.mac.target` contains only the ARM64 `zip` target, so `dist:mac` builds `release/Surffish-<version>-mac-arm64.zip`, with the unpacked app at `release/mac-arm64/Surffish.app`. Ignore any `.blockmap` it writes. No updater uses it. The native `.node` addon remains unpacked from the app archive so Electron can load it.

Before publishing, inspect and test the app on an Apple-silicon Mac: verify it starts, the sidebar/native trackpad integration works, and `Surffish.app` contains the expected app identifier `com.pylotlight.surffish`. Check the zip with `unzip -tq` and get its checksum with `shasum -a 256`.

## Ad hoc Windows build

Not a release. Actions -> **windows build** -> Run workflow, pick a ref (default `main`) and `x64`, `arm64` or `both`. It builds on GitHub's hosted Windows runners (`windows-latest`, `windows-11-arm`) and uploads `Surffish-<version>-win-<arch>.zip` as a run artifact for 14 days. Nothing is published and no Cask changes.

Locally on Windows: `bun install && bun run dist:win`. Build on Windows itself: `build.electronDist` points at `node_modules/electron/dist`, which is the host's Electron, so a Linux or Mac `--win` build would package the wrong binary. The macOS native addons skip themselves off darwin.

The exe is unsigned: SmartScreen shows "Windows protected your PC", click **More info -> Run anyway**. The UI is tuned on macOS (vibrancy, NSPanel mini windows, menu bar popout), so expect rough edges.

## Future manual release and Cask update

`bun run release` does all of this. To do it by hand: for a future version, publish only `Surffish-<version>-mac-arm64.zip` as the macOS release asset. Render the Cask from the published zip's SHA-256, then review and push the source/Cask changes through the normal repository workflow:

```bash
bun scripts/render-cask.ts \
  --version X.Y.Z \
  --sha256-arm64 <published-zip-sha256> \
  --out Casks/surffish.rb
```

On a Mac with Homebrew, validate and install the Cask:

```bash
brew audit --cask --strict --online Casks/surffish.rb
brew tap pylotlight/surffish https://github.com/PylotLight/Surffish.git
brew install --cask surffish
```

The Surffish repository doubles as its tap; a separate `homebrew-*` repository is not needed. The Cask points at the zip asset.

## Unsigned-install note

The published artifacts are unsigned and not notarized. macOS may quarantine downloads and, depending on the OS version, show a “damaged” warning. Only for an app downloaded from the official release that you have verified and trust, remove the quarantine attribute with:

```bash
xattr -cr /Applications/Surffish.app
```

Then open the app again (or Control-click it and choose **Open** on first launch). This removes the quarantine attribute; it does not sign or notarize the app. Homebrew's former `--no-quarantine` option is not available, so the manual `xattr` step may be needed after installation.
