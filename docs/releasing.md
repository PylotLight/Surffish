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
5. Pushes main, pushes an annotated `vX.Y.Z` tag, creates the GitHub release with only the zip (REST calls via `curl --proxy "$SURFFISH_GH_PROXY"` with `SURFFISH_GH_TOKEN`/`GITHUB_TOKEN` when `SURFFISH_GH_PROXY` is set, which the release workflow uses on the Mac runner; otherwise through your fish `ghp` function, or plain gh with `SURFFISH_GH=gh`), and renders, commits and pushes `Casks/surffish.rb`.

The manual steps below are what it automates.

## Release notes

`docs/releases/vX.Y.Z.md` is published verbatim as the GitHub release body. Start from [docs/releases/TEMPLATE.md](releases/TEMPLATE.md); [docs/releases/v0.1.5.md](releases/v0.1.5.md) is the reference example. The draft `bun run release` writes from commit subjects is only raw material and needs rewriting to these rules:

- **Voice**: neutral, public-facing, third person ("Surffish now…", "Toolbar popovers close on…"). No first person, and never address the maintainer or reader casually ("you", "your", "we"). No asides, jokes or internal shorthand.
- **Intro**: a one-line summary of the headline changes under the `# Surffish vX.Y.Z` title.
- **Sections**, in this order, omitting any that are empty: New, Fixed, Data and storage, Performance, CI, Packaging.
- **Order**: user-facing changes first; internal, test and CI changes terse and at the bottom.
- **Bullets**: bold the feature name in New (`**Feeds**: …`), name menu paths in bold (Settings → **General**), quote extension and product names ("I still don't care about cookies"), and end each bullet with its PR numbers in parentheses (#120) or (#119, #122).

## Builds: ARM64 zip only

Build on an Apple-silicon Mac with Xcode Command Line Tools installed. Surffish's Electron 44 runtime requires macOS Ventura (13) or later. Set `package.json` to the approved version before building. The build also compiles the AppKit trackpad addon and needs Apple's `xcrun`/Clang toolchain.

```bash
bun install
bun run typecheck
bun run test
bun run dist:mac
```

`build.mac.target` contains only the ARM64 `zip` target, so `dist:mac` builds `release/Surffish-<version>-mac-arm64.zip`, with the unpacked app at `release/mac-arm64/Surffish.app`. Ignore any `.blockmap` it writes. No updater uses it. The native `.node` addon remains unpacked from the app archive so Electron can load it.

Before publishing, inspect and test the app on an Apple-silicon Mac: verify it starts, the sidebar/native trackpad integration works, and `Surffish.app` contains the expected app identifier `com.pylotlight.surffish`. Check the zip with `unzip -tq` and get its checksum with `shasum -a 256`.

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

