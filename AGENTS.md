# Agent notes for Surffish

Bun + Electron + React desktop browser. Setup, scripts and architecture: [docs/development.md](docs/development.md).

- Before opening a PR: `bun lint` (requires Bun canary), `bun run format:check`, `bun run typecheck`, and `bun run test` must pass.
- Pure logic goes in `src/shared` with a unit test added to the `test` script in `package.json`.
- Never cut a release (`bun run release`) without the maintainer's approval.

## Release notes

`docs/releases/vX.Y.Z.md` is published as the GitHub release body. Follow the **Release notes** section of [docs/releasing.md](docs/releasing.md#release-notes), start from [docs/releases/TEMPLATE.md](docs/releases/TEMPLATE.md), and match [docs/releases/v0.1.5.md](docs/releases/v0.1.5.md). In short: neutral third person, no "you"/"we", no jokes; sections New / Fixed / Data and storage / Performance / CI / Packaging (omit empty); one-line intro; bold feature names; PR numbers in parens; user-facing first, CI terse last.
