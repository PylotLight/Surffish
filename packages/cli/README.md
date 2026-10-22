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

The last line rotates every 2 seconds between what the launcher is doing and a few Surffish tips. When the download finishes:

```text
  ✓ downloaded 119.1 MB in 10s (11.8 MB/s)
  ✓ verified sha256 9435b0ee8b6b…0db216 (matches the npm package (recorded at publish))
  ✓ unpacked with ditto to ~/.cache/surffish/0.1.22
  → launching Surffish v0.1.22
  remove it later with bunx @pylotlight/surffish --uninstall
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
--uninstall     delete the cached downloads, print what else is left and how to remove it
--purge         same as --uninstall --all: also delete Surffish's own data (asks first)
-y, --yes       with --uninstall --all: don't ask
--no-launch     download, verify and unpack, but don't open the app
-v, --version   print the launcher version and the Surffish version it runs
-h, --help      help
```

Anything else (a URL, for example) is passed to Surffish. Put `--` in front of an argument the launcher would otherwise take, such as `-- --version`.

| Environment              | Effect                                                                                                                            |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| `XDG_CACHE_HOME`         | cache base directory (default `~/.cache`)                                                                                         |
| `SURFFISH_CLI_CACHE_DIR` | exact cache directory                                                                                                             |
| `GITHUB_TOKEN`           | used for GitHub API calls, which only `--latest` or a version without a recorded checksum need (60 unauthenticated calls an hour) |
| `NO_COLOR`, `CI`         | no colour / plain output                                                                                                          |

## How it verifies the download

The npm version always equals the Surffish version it launches. When the release workflow publishes the package, it writes `release.json` into it with the zip's SHA-256 (GitHub's asset digest, cross-checked by downloading the zip once). The package is published with npm provenance, so that checksum is tied to the workflow run that produced it. The launcher hashes the zip as it streams and refuses to unpack anything that doesn't match.

`--latest`, or a release without a recorded checksum, uses the GitHub releases API asset `digest` instead (or a `SHA256SUMS` asset if a release has one). With no checksum at all, it stops.

## Unsigned app

Surffish isn't signed or notarized yet. Files downloaded by Node or Bun don't get macOS's `com.apple.quarantine` flag, so Gatekeeper's "damaged" dialog doesn't appear. If something did add the flag, the launcher removes it from the cached app and says so.

## Proxies

Under Bun (bunx without Node installed), downloads can't go through a `socks5://` `HTTPS_PROXY`, because Bun's fetch only supports http(s) proxies. Use npx, or unset it.

## Uninstall

```bash
bunx @pylotlight/surffish --uninstall          # or npx
```

This deletes the launcher's download cache (`~/.cache/surffish`, or `$XDG_CACHE_HOME/surffish` / `$SURFFISH_CLI_CACHE_DIR`), which holds the app itself, and then prints what's still on disk with the commands to remove it. Quit Surffish first: it refuses to run while the app is open.

What Surffish itself leaves behind, all in your home folder:

| Path                                                                    | What                                                                 |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `~/Library/Application Support/Surffish`                                | your profile: bookmarks, history, cookies, settings, extensions      |
| `~/Library/Caches/Surffish`, `~/Library/Caches/com.pylotlight.surffish` | caches                                                               |
| `~/Library/HTTPStorages/com.pylotlight.surffish`                        | macOS network storage                                                |
| `~/Library/Preferences/com.pylotlight.surffish.plist`                   | macOS preferences                                                    |
| `~/Library/Saved Application State/com.pylotlight.surffish.savedState`  | window restore state                                                 |
| `~/Library/Logs/Surffish`                                               | logs                                                                 |
| keychain item `Surffish Safe Storage`                                   | the key that encrypts saved cookies, quick unlock and PDF signatures |

To delete those too:

```bash
bunx @pylotlight/surffish --uninstall --all    # asks y/N first; add --yes to skip that
bunx @pylotlight/surffish --purge --yes        # same thing, shorter
```

It only removes those exact paths (plus `defaults delete com.pylotlight.surffish` and the keychain item), never anything else.

Left for you:

- bun and npm cache the launcher package itself (a few KB): `bun pm cache rm` (clears bun's whole package cache), or `rm -rf ~/.npm/_npx` for npx. `bun remove -g @pylotlight/surffish` if you installed it globally.
- If Surffish is your default browser, pick another one in System Settings → Desktop & Dock → Default web browser before you remove it. macOS forgets the registration once the app is gone.
- A Homebrew install is separate: `brew uninstall --cask surffish`.

---

Working on the launcher itself? See [DEVELOPING.md](https://github.com/PylotLight/Surffish/blob/main/packages/cli/DEVELOPING.md).
