# Developing the launcher (`packages/cli`)

Not published to npm (only `README.md` ships, plus `bin/`, `lib/`, `app.config.mjs` and `release.json`). The user-facing docs are in [README.md](README.md).

The launcher is plain ES modules with no dependencies and no build step. It isn't part of the Electron app or the root `bun install`.

## Reusing it for another app

Everything Surffish-specific is in [`app.config.mjs`](app.config.mjs): display name, command/cache id, npm name, GitHub repo, release asset pattern, `.app` name, supported platforms and messages, and the rotating tips. `lib/` is generic. For another app with the same release shape (a macOS `.app` zipped on GitHub Releases), copy this folder, edit `app.config.mjs` (including `uninstall`: the app's data paths, bundle id, process name and keychain items), rename `bin/surffish.mjs` and the `name`/`bin`/`repository` fields in `package.json`, and add the `npm` job from `.github/workflows/release.yml`.

## Development

The README's Uninstall table mirrors `uninstall.userData` / `keychain` in `app.config.mjs`; update both when the app starts writing somewhere new (paths come from `app.getPath(...)` uses in `src/main`, `boot.ts`'s compile cache, and `safeStorage`).

```bash
bun run test:cli                                  # from the repo root (or: bun test ./test here)
node packages/cli/bin/surffish.mjs --help
```

Simulate a download on any OS (no launch outside macOS):

```bash
SURFFISH_CLI_ASSET_URL=http://127.0.0.1:8765/app.zip SURFFISH_CLI_SHA256=<sha256> \
SURFFISH_CLI_VERSION=0.1.22 node packages/cli/bin/surffish.mjs --no-launch
```

`ci.yml` has a manual input (`cli_real_download`) that downloads and unpacks the real v0.1.22 release on the Mac runner.

## Publishing

The `npm` job in `.github/workflows/release.yml` publishes this package after the GitHub release and the Cask bump succeed. It runs on a GitHub-hosted runner, because npm trusted publishing doesn't support self-hosted runners, and uses OIDC, so there's no `NPM_TOKEN`. It sets the package version to the release version, writes `release.json`, and runs `npm publish --provenance --access public`. A release dry run packs it with `npm publish --dry-run`. Until the repo variable `NPM_PUBLISH` is `true`, real releases skip it with a warning.

One-time setup:

1. **First publish by hand.** A trusted publisher can only be added to a package that already exists. The `@pylotlight` scope belongs to the `pylotlight` npm account.
   ```bash
   npm login                                     # as pylotlight
   cd packages/cli
   node scripts/prepare-publish.mjs --version 0.1.22 --verify-download
   npm publish --access public                   # no --provenance from a laptop
   git checkout package.json && rm release.json  # leave the repo at 0.0.0-dev
   ```
2. **Add the trusted publisher** on npmjs.com → `@pylotlight/surffish` → Settings → Trusted publishing → GitHub Actions: organization or user `PylotLight`, repository `Surffish`, workflow filename `release.yml`, no environment. Tick **Allow npm publish**, because configurations created after Sep 3 2026 only allow `npm stage publish` by default. Or from the CLI (npm 11.15+, 2FA on): `npm trust github @pylotlight/surffish --repo PylotLight/Surffish --file release.yml --allow-publish`. A new configuration expires unless it completes a publish within 2 days, so do this shortly before the next release.
3. **Turn the job on:** set the repo variable `NPM_PUBLISH=true` (Settings → Secrets and variables → Actions → Variables, or `gh variable set NPM_PUBLISH --body true -R PylotLight/Surffish`).
4. Optional, after the first CI publish works: package Settings → Publishing access → "Require two-factor authentication and disallow tokens".
