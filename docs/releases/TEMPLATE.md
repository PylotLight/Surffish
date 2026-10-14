<!--
Template for docs/releases/vX.Y.Z.md. Copy it, fill it in, delete this comment and any empty sections.
Rules: see "Release notes" in docs/releasing.md. Reference example: docs/releases/v0.1.5.md.
`bun run release` publishes the file verbatim as the GitHub release body.
-->
# Surffish vX.Y.Z

One-line summary of the most important user-facing changes, in plain third person.

## New
- **Feature name**: what it does and where to find it (Settings → **Section → Item**, ⌘K → **Command…**). Quote extension and product names, e.g. "Bitwarden" (#000)

## Fixed
- What was wrong, stated as the corrected behaviour (#000)

## Data and storage
- Changes to what is stored, where, migrations and fallbacks (#000)

## Performance
- Measurable improvements: size, launch time, fewer writes (#000)

## CI
- Terse one-liners for test, smoke and pipeline changes (#000)

## Packaging
- Apple silicon zip only, unsigned and not notarized. If macOS reports the app is damaged, run `xattr -cr /Applications/Surffish.app` on a copy downloaded from the official release
