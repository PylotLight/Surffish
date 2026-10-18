# @pylotlight/surffish

Run [Surffish](https://github.com/PylotLight/Surffish), the compact Electron browser with a glass tab sidebar, built-in ad blocking and a SOCKS5 switch, without installing it:

```bash
npx @pylotlight/surffish
bunx @pylotlight/surffish
```

The first run downloads the Surffish release zip from GitHub Releases, verifies its SHA-256, unpacks it into `~/.cache/surffish/<version>` and opens it. Every run after that opens the cached copy immediately, with no network access.

Requires macOS on Apple silicon (M-series), macOS 13 or newer, and Node.js 18.17+ or Bun. On other platforms the launcher prints what is and isn't supported and exits.

## What a first run looks like

```text
◆ Surffish v0.1.22 · first launch of this version, downloading once (119.1 MB)
  ███████████████████░░░░░░░░░░░  64%  76.2 MB / 119.1 MB  11.8 MB/s  ETA 4s
  › Cached in ~/.cache/surffish so the next launch is instant
```

The last line rotates every few seconds between what the launcher is doing and a few Surffish tips. When the download finishes:

```text
  ✓ downloaded 119.1 MB in 10s (11.8 MB/s)
  ✓ verified sha256 9435b0ee8b6b…0db216 (matches the npm package (recorded at publish))
  ✓ unpacked with ditto to ~/.cache/surffish/0.1.22
  → launching Surffish v0.1.22
```

Piped output, `CI=true` or `TERM=dumb` switch to plain log lines without escape codes, and `NO_COLOR` drops the colour. Ctrl+C during the download stops cleanly and deletes the partial file.

## Usage

```text
npx @pylotlight/surffish [options] [app args]
npx @pylotlight/surffish@0.1.22      run a specific release
surffish [options]                   after npm i -g @pylotlight/surffish

--latest        run the newest GitHub release instead of this package's version
--path          print the cached .app path for the resolved version and exit
--clear-cache   delete every cached download
--no-launch     download, verify and unpack, but don't open the app
-v, --version   print the launcher version and the Surffish version it runs
-h, --help      help
```

Anything else (a URL, for example) is passed to Surffish. Put `--` in front of an argument the launcher would otherwise take, such as `-- --version`.

| Environment | Effect |
|---|---|
| `XDG_CACHE_HOME` | cache base directory (default `~/.cache`) |
| `SURFFISH_CLI_CACHE_DIR` | exact cache directory |
| `GITHUB_TOKEN` | used for GitHub API calls, which only `--latest` or a version without a recorded checksum need (60 unauthenticated calls an hour) |
| `NO_COLOR`, `CI` | no colour / plain output |

## How it verifies the download

The npm version always equals the Surffish version it launches. When the release workflow publishes the package, it writes `release.json` into it with the zip's SHA-256 (GitHub's asset digest, cross-checked by downloading the zip once). The package is published with npm provenance, so that checksum is tied to the workflow run that produced it. The launcher hashes the zip as it streams and refuses to unpack anything that doesn't match.

`--latest`, or a release without a recorded checksum, uses the GitHub releases API asset `digest` instead (or a `SHA256SUMS` asset if a release has one). With no checksum at all, it stops.

## Unsigned app

Surffish isn't signed or notarized yet. Files downloaded by Node or Bun don't get macOS's `com.apple.quarantine` flag, so Gatekeeper's "damaged" dialog doesn't appear. If something did add the flag, the launcher removes it from the cached app and says so.

## Notes

- Under Bun (bunx without Node installed), downloads can't go through a `socks5://` `HTTPS_PROXY`, because Bun's fetch only supports http(s) proxies. Use npx, or unset it.
- The launcher is plain ES modules with no dependencies and no build step. It isn't part of the Electron app or the root `bun install`.

## Reusing it for another app

Everything Surffish-specific is in [`app.config.mjs`](app.config.mjs): display name, command/cache id, npm name, GitHub repo, release asset pattern, `.app` name, supported platforms and messages, and the rotating tips. `lib/` is generic. For another app with the same release shape (a macOS `.app` zipped on GitHub Releases), copy this folder, edit `app.config.mjs`, rename `bin/surffish.mjs` and the `name`/`bin`/`repository` fields in `package.json`, and add the `npm` job from `.github/workflows/release.yml`.

## Development

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
