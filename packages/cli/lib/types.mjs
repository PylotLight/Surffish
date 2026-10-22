// JSDoc types only (no runtime code). Plain JS so the bin runs under Node and Bun with no build step.

/**
 * @typedef {object} AppConfig
 * @property {string} displayName      shown in messages ("Surffish")
 * @property {string} id               command + cache folder name ("surffish")
 * @property {string} packageName      npm package name ("@pylotlight/surffish")
 * @property {string} repo             GitHub owner/repo with releases tagged v<version>
 * @property {string} envPrefix        prefix for override env vars ("SURFFISH_CLI")
 * @property {(version: string) => string} assetName  release asset file name for a version
 * @property {string} appBundle        the .app inside the zip ("Surffish.app")
 * @property {number} approxSizeMB     rough download size, for the first line only
 * @property {string[]} supported      `${platform}-${arch}` keys with a build
 * @property {Record<string, string>} unsupported  messages by `${platform}-${arch}`, platform, or "default"
 * @property {string} [firstRunNote]   printed after the first launch of a fresh download
 * @property {string[]} tips           rotated under the progress bar
 * @property {UninstallConfig} [uninstall]  what --uninstall lists / deletes besides the cache
 */

/**
 * @typedef {object} UninstallConfig
 * @property {string} [processName]    `pgrep -x` name; --uninstall refuses while it runs
 * @property {string} [bundleId]       macOS bundle id (`defaults delete` on --all)
 * @property {{ path: string, what?: string }[]} [userData]  "~/..." or absolute paths the app writes
 * @property {{ service: string, what?: string }[]} [keychain]  generic-password items by service
 * @property {string[]} [notes]        printed at the end (default browser, Homebrew, ...)
 */

/**
 * @typedef {object} Target
 * @property {string} version          e.g. "0.1.22"
 * @property {string} assetName
 * @property {string} url              download URL
 * @property {string | null} sha256    lowercase hex, null when no checksum is known
 * @property {string} checksumSource   where sha256 came from (for the "verified" line)
 * @property {number | null} size      bytes, when known
 */

export {};
