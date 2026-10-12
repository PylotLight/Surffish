# macOS releases and Homebrew

Surffish has a **manual** macOS packaging and publishing path, driven by a local Bash helper. There is no automated GitHub Actions release workflow: do not enable or add Actions for publishing as part of this setup. The existing app version is `0.1.0`, but no macOS release archives have been published yet, so the Apple-silicon-only starter Cask in `Casks/surffish.rb` is intentionally not installable until real archives and checksums are available.

## Build the macOS archives

Build on a Mac with Xcode Command Line Tools installed. Surffish's Electron 44 runtime requires macOS Ventura (13) or later. Set `package.json` to the approved release version before building; `electron-builder` uses it in the artifact filenames. The build also compiles the universal AppKit trackpad addon; that step needs Apple's `xcrun`/Clang toolchain and cannot be completed on Linux.

```bash
bun install
bun run typecheck
bun run test
bun run dist:mac
```

`dist:mac` builds the app, then packages Apple silicon (`arm64`) ZIP and DMG files only under `release/`. The supported assets are `Surffish-<version>-mac-arm64.zip` and `Surffish-<version>-mac-arm64.dmg`; Homebrew installs from the ZIP. The native `.node` addon is explicitly unpacked from the app archive so Electron can load it.

**Transition note:** A `dist:mac` process already running when the ARM64-only source change is applied may still finish writing its previously configured Intel (`x64`) ZIP/DMG files. This source change affects builds started afterward, not that in-progress process. Treat its Intel output as stale and do not publish it; only ARM64 artifacts are supported.

Before considering the first release, inspect and test the ARM64 bundle on an Apple-silicon Mac. Verify that the app starts, the sidebar/native trackpad integration works, and the bundle contains `Surffish.app` with the expected app identifier `com.pylotlight.surffish`.

## Manual release and Cask update

Publishing is deliberately gated and remains manual; there is no release workflow. First prepare and review a **final** release-notes file (do not pass the `-draft.md` file), and inspect/test the ARM64 app bundle on an Apple-silicon Mac. In either mode, the helper checks that the worktree is clean, the branch is current `main`, and the package and build targets are version `0.1.0` and ARM64-only. It runs typecheck and unit tests, verifies the ZIP/DMG and app bundle, calculates both checksums, and renders a preview Cask from the actual ZIP checksum. The normal mode also runs `dist:mac`; reuse mode skips that packaging build.

From fish, run Bash explicitly and pass the path to the final notes file:

```fish
bash scripts/publish-macos-release.sh /path/to/approved-release-notes.md
```

The helper starts Fish, loads `~/.config/fish/config.fish` (or `$XDG_CONFIG_HOME/fish/config.fish` when set), and routes **every** GitHub CLI operation—including authentication checks—through the `ghp` function defined there. Ensure `ghp` is available after sourcing that config and is authenticated for `PylotLight/Surffish`; the helper does not fall back to invoking `gh` directly. You can check access in Fish first with `ghp auth status --hostname github.com` and `ghp repo view PylotLight/Surffish`.

If the ARM64 ZIP and DMG already exist and must not be rebuilt, pass the full source commit SHA used to build them:

```fish
bash scripts/publish-macos-release.sh --reuse-artifacts FULL_40_CHARACTER_SOURCE_SHA /path/to/approved-release-notes.md
```

The declared artifact source SHA must be the full 40-character lowercase SHA, be an ancestor of the clean current `main` commit at `origin/main`, and have no intervening application/build-file changes (only `docs/` files and this publishing helper may differ). The tag still targets current `origin/main`. Because ZIP/DMG files do not prove their own source commit, reuse mode also requires typing `ARTIFACT SOURCE COMMIT <full-sha>` at a separate interactive prompt to attest that **both** existing artifacts were built from that exact commit. Only after that attestation does the normal `PUBLISH v0.1.0` confirmation appear. A mismatch or any other input cancels before creating a tag or release. Both modes still require running the helper from a native Apple-silicon Mac with Apple's command-line tools.

The script prints the commit, release title, exact two asset names, sizes, checksums, and full notes before it will do anything public. The annotated `v0.1.0` tag must already exist and match its pinned tag object and commit; the helper only verifies it and never creates, moves, deletes, or pushes a tag. After confirmation, it creates or resumes the public GitHub release with **only** `Surffish-0.1.0-mac-arm64.zip` and `Surffish-0.1.0-mac-arm64.dmg`, verifies that exact asset list, then renders `Casks/surffish.rb` from the ZIP checksum and commits/pushes the Cask update to `main`. It does not change or enable GitHub Actions.

Requirements: a clean, up-to-date `main` checkout matching `origin/main`, configured Git commit identity, Fish with a readable config that defines the authenticated `ghp` function, Bun/dependencies, and Xcode Command Line Tools on an Apple-silicon Mac. If GitHub authentication is missing, use `ghp auth login` from Fish. If dependencies are not installed yet, run `bun install` first. If a publish step fails after the confirmation, inspect the tag/release and current Git status before attempting recovery; the tag or public release may already exist.

After publishing, on a Mac with Homebrew, validate the Cask against the published archives, then install:

   ```bash
   brew audit --cask --strict --online Casks/surffish.rb
   brew tap pylotlight/surffish https://github.com/PylotLight/Surffish.git
   brew install --cask surffish
   ```

The Surffish repository doubles as its tap; a separate `homebrew-*` repository is not needed. Until the cask is rendered with actual release hashes, the checked-in starter has zeroed placeholder checksums and its release URL will not resolve.

## Unsigned-install note

The planned artifacts are unsigned and not notarized. macOS may quarantine downloads and, depending on the OS version, show a “damaged” warning. Only for an app downloaded from the official release that you have verified and trust, remove the quarantine attribute with:

```bash
xattr -cr /Applications/Surffish.app
```

Then open the app again (or Control-click it and choose **Open** on first launch). This removes the quarantine attribute; it does not sign or notarize the app. Homebrew's former `--no-quarantine` option is not available, so the manual `xattr` step may be needed after installation.
