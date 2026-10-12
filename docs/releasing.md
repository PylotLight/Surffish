# macOS releases and Homebrew

Surffish has a **manual** macOS packaging path. There is no release workflow in this repository: do not enable or add GitHub Actions for publishing as part of this setup. The existing app version is `0.1.0`, but no macOS release archives have been published yet, so the starter cask in `Casks/surffish.rb` is intentionally not installable until real archives and checksums are available.

## Build the macOS archives

Build on a Mac with Xcode Command Line Tools installed. Surffish's Electron 44 runtime requires macOS Ventura (13) or later. Set `package.json` to the approved release version before building; `electron-builder` uses it in the artifact filenames. The build also compiles the universal AppKit trackpad addon; that step needs Apple's `xcrun`/Clang toolchain and cannot be completed on Linux.

```bash
bun install
bun run typecheck
bun run test
bun run dist:mac
```

`dist:mac` builds the app, then packages Intel (`x64`) and Apple silicon (`arm64`) ZIP and DMG files under `release/`. The ZIP assets are named `Surffish-<version>-mac-arm64.zip` and `Surffish-<version>-mac-x64.zip`; Homebrew installs from those ZIPs. The native `.node` addon is explicitly unpacked from the app archive so Electron can load it.

Before considering the first release, inspect and test both bundles on their matching Mac architectures. Verify that the app starts, the sidebar/native trackpad integration works, and the bundle contains `Surffish.app` with the expected app identifier `com.pylotlight.surffish`.

## Manual release and cask update

Release publishing is deliberately separate from packaging. **Do not create or push a version tag or publish a GitHub release until the exact version, release notes, and all four archive files have been shown to the user and approved.** Once that approval is given and the archives have been built and checked:

1. From the approved commit, create and push the matching annotated tag, then create the GitHub release with the approved notes and all four artifacts. This is manual; no release workflow or Actions enablement is part of this setup:

   ```bash
   # Replace X.Y.Z only after the release payload has been approved.
   version="X.Y.Z"
   git tag -a "v${version}" -m "Surffish v${version}"
   git push origin "v${version}"
   gh release create "v${version}" \
     "release/Surffish-${version}-mac-arm64.zip" \
     "release/Surffish-${version}-mac-x64.zip" \
     "release/Surffish-${version}-mac-arm64.dmg" \
     "release/Surffish-${version}-mac-x64.dmg" \
     --title "Surffish v${version}" \
     --notes-file /path/to/approved-release-notes.md
   ```

   `dist:mac` only builds files; it does not create a tag or release. Never run these publishing commands before the approval gate above.
2. Calculate the two ZIP checksums and render the Cask with the same approved version:

   ```bash
   version="X.Y.Z" # use the approved version
   sha256_arm="$(shasum -a 256 "release/Surffish-${version}-mac-arm64.zip" | awk '{print $1}')"
   sha256_intel="$(shasum -a 256 "release/Surffish-${version}-mac-x64.zip" | awk '{print $1}')"
   bun scripts/render-cask.ts \
     --version "$version" \
     --sha256-arm "$sha256_arm" \
     --sha256-intel "$sha256_intel" \
     --out Casks/surffish.rb
   ```

3. Commit the rendered Cask to the tap's default branch:

   ```bash
   git add Casks/surffish.rb
   git commit -m "chore(tap): update Surffish Cask to v${version}"
   git push origin main
   ```

4. On a Mac with Homebrew, validate the Cask against the published archives, then install:

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
