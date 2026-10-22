// Everything app-specific lives here. lib/ is generic: to reuse this launcher for another app
// (Inkfish, Blobfish, ...), copy packages/cli, edit this object, the package.json name/bin, and the
// README. Nothing in lib/ mentions Surffish.

/** @type {import('./lib/types.mjs').AppConfig} */
export default {
  // Shown in messages and the progress UI.
  displayName: "Surffish",
  // The command name (package.json "bin") and the cache folder: ~/.cache/<id>/<version>.
  id: "surffish",
  // npm package name, used in help text ("npx @pylotlight/surffish@0.1.22").
  packageName: "@pylotlight/surffish",
  // GitHub owner/repo that publishes releases tagged v<version>.
  repo: "PylotLight/Surffish",
  // Env var prefix for overrides: SURFFISH_CLI_ASSET_URL, SURFFISH_CLI_SHA256, SURFFISH_CLI_CACHE_DIR.
  envPrefix: "SURFFISH_CLI",
  // Release asset name for a version. Must match what the release workflow uploads.
  assetName: (version) => `Surffish-${version}-mac-arm64.zip`,
  // The .app inside the zip (opened with `open`).
  appBundle: "Surffish.app",
  // Approximate download size, only for the "first run" line before the server reports a size.
  approxSizeMB: 120,
  // `${process.platform}-${process.arch}` keys that have a release build.
  supported: ["darwin-arm64"],
  // Friendly messages for everything else. `default` covers any key not listed.
  unsupported: {
    "darwin-x64":
      "Surffish only ships for Apple silicon (M-series) Macs. Intel Macs are not supported yet.",
    "win32-x64":
      "Windows is not supported by this launcher yet. Ad hoc Windows builds exist as artifacts of the\n" +
      '"windows build" workflow: https://github.com/PylotLight/Surffish/actions/workflows/windows-build.yml',
    "win32-arm64":
      "Windows is not supported by this launcher yet. Ad hoc Windows builds exist as artifacts of the\n" +
      '"windows build" workflow: https://github.com/PylotLight/Surffish/actions/workflows/windows-build.yml',
    linux:
      "There is no Linux build of Surffish. It runs from source for development:\n" +
      "https://github.com/PylotLight/Surffish/blob/main/docs/development.md",
    default: "Surffish only ships for macOS on Apple silicon for now.",
  },
  // Printed after launching from a fresh download.
  firstRunNote:
    "Surffish is unsigned and not notarized. If macOS says it is damaged, see\n" +
    "https://github.com/PylotLight/Surffish#faq",
  // --uninstall: what the app itself writes outside the launcher cache. Listed (and with --all
  // deleted) only when it exists. Paths come from src/main (userData = Application Support/<name>,
  // compile cache in boot.ts, logs, safeStorage) plus what macOS keeps per bundle id.
  uninstall: {
    // `pgrep -x` name of the main process; --uninstall refuses while it's running.
    processName: "Surffish",
    // package.json build.appId
    bundleId: "com.pylotlight.surffish",
    userData: [
      {
        path: "~/Library/Application Support/Surffish",
        what: "profile: bookmarks, history, cookies, settings, extensions",
      },
      { path: "~/Library/Caches/Surffish", what: "web + compile caches" },
      { path: "~/Library/Caches/com.pylotlight.surffish", what: "macOS cache" },
      {
        path: "~/Library/HTTPStorages/com.pylotlight.surffish",
        what: "macOS network storage",
      },
      {
        path: "~/Library/Preferences/com.pylotlight.surffish.plist",
        what: "macOS preferences",
      },
      {
        path: "~/Library/Saved Application State/com.pylotlight.surffish.savedState",
        what: "window restore state",
      },
      { path: "~/Library/Logs/Surffish", what: "logs" },
    ],
    // Electron safeStorage key (encrypts saved cookies, quick unlock and PDF signatures).
    keychain: [{ service: "Surffish Safe Storage", what: "safeStorage key" }],
    notes: [
      "If Surffish is your default browser, pick another one first (System Settings → Desktop & Dock →",
      "Default web browser); macOS forgets the registration once the app is gone.",
      'Dev builds use their own profiles (~/Library/Application Support/Surffish Dev, "Surffish <name>"); those are not touched.',
      "Installed with Homebrew too? brew uninstall --cask surffish",
    ],
  },
  // Rotated under the progress bar while downloading, between the "what's happening" lines.
  tips: [
    "Ad and tracker blocking is built in: uBlock Origin's lists, EasyList, EasyPrivacy and more",
    "Route everything through an ssh -D tunnel: Settings → General → SOCKS5 proxy",
    "Per-site proxy rules plus a kill switch, so nothing slips out direct if the tunnel drops",
    "Shift-click a link to Glance at it in a floating sheet, ⌘↩ keeps it as a tab",
    "Pop tabs out into mini windows that float above other apps with ⇧⌘M",
    "⌘K opens the command palette: commands, open tabs and search keywords in one box",
    "Split view puts two tabs side by side with ⇧⌘=",
    "Reader view (⌥⌘R) strips a page down to just the article",
  ],
};
