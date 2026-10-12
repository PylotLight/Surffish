# macOS builds and releases

Surffish's macOS release process is manual; there is no GitHub Actions release workflow. The published `v0.1.0` release has both ARM64 ZIP and DMG assets. Those existing assets and the tag remain unchanged; the current Homebrew Cask installs from the already-published DMG.

## Future builds: ARM64 DMG only

Build on an Apple-silicon Mac with Xcode Command Line Tools installed. Surffish's Electron 44 runtime requires macOS Ventura (13) or later. Set `package.json` to the approved version before building. The build also compiles the AppKit trackpad addon and needs Apple's `xcrun`/Clang toolchain.

```bash
bun install
bun run typecheck
bun run test
bun run dist:mac
```

`build.mac.target` contains only the ARM64 `dmg` target, so future `dist:mac` builds produce `Surffish-<version>-mac-arm64.dmg` and do not produce a ZIP or ZIP blockmap. `build.dmg.writeUpdateInfo: false` disables DMG blockmap/update-info generation as well. No updater currently depends on ZIP artifacts. The native `.node` addon remains unpacked from the app archive so Electron can load it.

Before publishing a future DMG, inspect and test the app on an Apple-silicon Mac: verify it starts, the sidebar/native trackpad integration works, and `Surffish.app` contains the expected app identifier `com.pylotlight.surffish`. Verify the DMG with `hdiutil verify` and calculate its checksum with `shasum -a 256`.

## Future manual release and Cask update

There is no version-agnostic release-publishing helper yet. For a future version, publish only `Surffish-<version>-mac-arm64.dmg` as the macOS release asset; do not add ZIP or blockmap assets. Render the Cask from the published DMG's ARM64 SHA-256, then review and push the source/Cask changes through the normal repository workflow:

```bash
bun scripts/render-cask.ts \
  --version X.Y.Z \
  --sha256-arm64 <published-dmg-sha256> \
  --out Casks/surffish.rb
```

On a Mac with Homebrew, validate and install the Cask:

```bash
brew audit --cask --strict --online Casks/surffish.rb
brew tap pylotlight/surffish https://github.com/PylotLight/Surffish.git
brew install --cask surffish
```

The Surffish repository doubles as its tap; a separate `homebrew-*` repository is not needed. The checked-in Cask's `0.1.0` checksum is for the published ARM64 DMG.

## Legacy v0.1.0 release helper

`scripts/publish-macos-release.sh` is pinned to the already-published `v0.1.0` release and deliberately retains validation of its historical ARM64 ZIP+DMG asset pair. It is not the pipeline for future releases: the current `package.json` has a DMG-only target, and future releases must use only a DMG asset. Do not use the legacy helper to build or publish a newer version. The v0.1.0 tag and its two published assets are not to be changed as part of this migration.

## Unsigned-install note

The published artifacts are unsigned and not notarized. macOS may quarantine downloads and, depending on the OS version, show a “damaged” warning. Only for an app downloaded from the official release that you have verified and trust, remove the quarantine attribute with:

```bash
xattr -cr /Applications/Surffish.app
```

Then open the app again (or Control-click it and choose **Open** on first launch). This removes the quarantine attribute; it does not sign or notarize the app. Homebrew's former `--no-quarantine` option is not available, so the manual `xattr` step may be needed after installation.
