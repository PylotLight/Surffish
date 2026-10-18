// Pure helpers (no network, no process state), unit tested in test/core.test.mjs.
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** @typedef {import('./types.mjs').AppConfig} AppConfig */

export const DEV_VERSION = '0.0.0-dev'

const SEMVER = /^v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/

/** "v0.1.22" | "0.1.22" -> "0.1.22"; anything else -> null. */
export function normalizeVersion(input) {
  if (typeof input !== 'string') return null
  const m = SEMVER.exec(input.trim())
  return m ? /** @type {string} */ (m[1]) : null
}

/**
 * Which release to run. The npm package's own version is the default (so `npx pkg@0.1.20` runs
 * 0.1.20); `--latest`, or running an unpublished dev copy (version 0.0.0-dev), means "ask GitHub".
 * @param {{ packageVersion: string, latest?: boolean }} opts
 * @returns {{ kind: 'pinned', version: string } | { kind: 'latest', reason: 'flag' | 'dev' }}
 */
export function resolveVersionRequest({ packageVersion, latest = false }) {
  if (latest) return { kind: 'latest', reason: 'flag' }
  const version = normalizeVersion(packageVersion)
  if (!version || version === DEV_VERSION) return { kind: 'latest', reason: 'dev' }
  return { kind: 'pinned', version }
}

/** "sha256:ABC.." | "abc.." -> "abc.." (64 hex chars) or null. */
export function parseSha256(value) {
  if (typeof value !== 'string') return null
  const hex = value.trim().replace(/^sha256:/i, '').toLowerCase()
  return /^[0-9a-f]{64}$/.test(hex) ? hex : null
}

/** Finds `name` in a SHA256SUMS / `shasum -a 256` style listing. */
export function findInChecksumList(text, name) {
  for (const line of String(text).split(/\r?\n/)) {
    const m = /^([0-9a-fA-F]{64})\s+\*?(.+?)\s*$/.exec(line)
    if (m && m[2] === name) return /** @type {string} */ (m[1]).toLowerCase()
  }
  return null
}

/** Throws a readable error when `actual` isn't `expected`. */
export function assertChecksum(actual, expected, label = 'download') {
  const a = parseSha256(actual)
  const e = parseSha256(expected)
  if (!a || !e) throw new Error(`checksum for ${label} is missing or malformed`)
  if (a !== e) {
    throw new Error(`SHA-256 mismatch for ${label}\n  expected ${e}\n  got      ${a}\nThe file was deleted. Try again, or report it if it keeps happening.`)
  }
  return true
}

/** @returns {Promise<string>} hex sha256 of a file */
export function sha256File(path) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    createReadStream(path)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', reject)
      .on('end', () => resolve(hash.digest('hex')))
  })
}

/**
 * ~/.cache/<id>, or $XDG_CACHE_HOME/<id>, or $<PREFIX>_CACHE_DIR verbatim.
 * @param {AppConfig} config
 * @param {Record<string, string | undefined>} [env]
 * @param {string} [home]
 */
export function cacheRoot(config, env = process.env, home = homedir()) {
  const override = env[`${config.envPrefix}_CACHE_DIR`]
  if (override) return override
  const xdg = env.XDG_CACHE_HOME
  // XDG says relative values must be ignored
  if (xdg && xdg.startsWith('/')) return join(xdg, config.id)
  return join(home, '.cache', config.id)
}

/** @param {AppConfig} config */
export function versionDir(config, version, env = process.env, home = homedir()) {
  return join(cacheRoot(config, env, home), version)
}

/** @param {AppConfig} config */
export function appPath(config, version, env = process.env, home = homedir()) {
  return join(versionDir(config, version, env, home), config.appBundle)
}

/** Replaces the home directory with ~ for display. */
export function tildify(path, home = homedir()) {
  return home && (path === home || path.startsWith(home + '/')) ? '~' + path.slice(home.length) : path
}

/** @param {AppConfig} config */
export function releaseAssetUrl(config, version) {
  return `https://github.com/${config.repo}/releases/download/v${version}/${config.assetName(version)}`
}

/**
 * null when supported, else the message to print.
 * @param {AppConfig} config
 */
export function platformSupport(config, platform = process.platform, arch = process.arch) {
  const key = `${platform}-${arch}`
  if (config.supported.includes(key)) return null
  return config.unsupported[key] ?? config.unsupported[platform] ?? config.unsupported.default ?? `${config.displayName} doesn't support ${key} yet.`
}

/**
 * @param {string[]} argv  process.argv.slice(2)
 * Launcher flags are consumed; everything else (a URL, an app flag, anything after `--`) is passed
 * to the app.
 * `--all` and `-y/--yes` only mean something next to `--uninstall`; on their own they go to the app.
 * `--purge` is `--uninstall --all`.
 * @returns {{ help: boolean, version: boolean, latest: boolean, clearCache: boolean, path: boolean, noLaunch: boolean,
 *   uninstall: boolean, all: boolean, yes: boolean, passthrough: string[] }}
 */
export function parseArgs(argv) {
  const out = { help: false, version: false, latest: false, clearCache: false, path: false, noLaunch: false, uninstall: false, all: false, yes: false, passthrough: /** @type {string[]} */ ([]) }
  const end = argv.indexOf('--')
  const own = end === -1 ? argv : argv.slice(0, end)
  const uninstalling = own.includes('--uninstall') || own.includes('--purge')
  let rest = false
  for (const arg of argv) {
    if (rest) { out.passthrough.push(arg); continue }
    switch (arg) {
      case '--': rest = true; break
      case '-h': case '--help': out.help = true; break
      case '-v': case '--version': out.version = true; break
      case '--latest': out.latest = true; break
      case '--clear-cache': out.clearCache = true; break
      case '--path': out.path = true; break
      case '--no-launch': out.noLaunch = true; break
      case '--uninstall': out.uninstall = true; break
      case '--purge': out.uninstall = true; out.all = true; break
      case '--all': if (uninstalling) out.all = true; else out.passthrough.push(arg); break
      case '-y': case '--yes': if (uninstalling) out.yes = true; else out.passthrough.push(arg); break
      default: out.passthrough.push(arg)
    }
  }
  return out
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '?'
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '--'
  if (seconds < 60) return `${Math.ceil(seconds)}s`
  const m = Math.floor(seconds / 60)
  const s = Math.round(seconds % 60)
  return `${m}m${String(s).padStart(2, '0')}s`
}
