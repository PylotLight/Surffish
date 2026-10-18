// The launcher: resolve version -> cached? launch : download + verify + unpack -> launch.
// Generic; everything app-specific comes from the config object (see app.config.mjs).
import { spawn, spawnSync } from 'node:child_process'
import { randomBytes, createHash } from 'node:crypto'
import { createWriteStream, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  appPath, assertChecksum, cacheRoot, formatBytes, formatDuration, parseArgs, platformSupport,
  resolveVersionRequest, tildify, versionDir,
} from './core.mjs'
import { readManifest, resolveTarget } from './release.mjs'
import { createUI, rotationLines } from './ui.mjs'
import { runUninstall } from './uninstall.mjs'

/** @typedef {import('./types.mjs').AppConfig} AppConfig */
/** @typedef {import('./types.mjs').Target} Target */

const MARKER = '.complete.json'

/** @param {AppConfig} config */
export function isCached(config, version, env = process.env) {
  const dir = versionDir(config, version, env)
  return existsSync(join(dir, MARKER)) && existsSync(join(dir, config.appBundle))
}

/** Newest fully cached version (semver-ish sort), or null. */
export function newestCached(config, env = process.env) {
  const root = cacheRoot(config, env)
  let names = []
  try { names = readdirSync(root) } catch { return null }
  const done = names.filter((n) => /^\d+\.\d+\.\d+/.test(n) && isCached(config, n, env))
  done.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  return done.at(-1) ?? null
}

function dirSize(path) {
  let total = 0
  let st
  try { st = statSync(path, { throwIfNoEntry: false }) } catch { return 0 }
  if (!st) return 0
  if (!st.isDirectory()) return st.size
  for (const name of readdirSync(path)) {
    try {
      const child = join(path, name)
      const s = statSync(child, { throwIfNoEntry: false })
      if (s?.isSymbolicLink?.()) continue
      total += s?.isDirectory() ? dirSize(child) : (s?.size ?? 0)
    } catch { /* ignore */ }
  }
  return total
}

/**
 * Streams `url` to `dest`, hashing as it goes. Follows redirects (fetch does).
 * @returns {Promise<{ sha256: string, bytes: number }>}
 */
export async function download(url, dest, { signal, onProgress = (_r, _t) => {}, fetchImpl = fetch, userAgent = 'launcher' } = {}) {
  const res = await fetchImpl(url, { redirect: 'follow', signal, headers: { 'User-Agent': userAgent } })
  if (!res.ok || !res.body) throw new Error(`download failed: HTTP ${res.status} for ${url}`)
  const total = Number(res.headers.get('content-length')) || NaN
  const hash = createHash('sha256')
  const out = createWriteStream(dest)
  const failed = new Promise((_, reject) => out.on('error', reject))
  failed.catch(() => {})
  let bytes = 0
  try {
    for await (const chunk of /** @type {AsyncIterable<Uint8Array>} */ (res.body)) {
      hash.update(chunk)
      bytes += chunk.byteLength
      if (!out.write(chunk)) await Promise.race([new Promise((r) => out.once('drain', r)), failed])
      onProgress(bytes, total)
    }
  } finally {
    await Promise.race([new Promise((r) => out.end(r)), failed])
  }
  if (Number.isFinite(total) && bytes !== total) throw new Error(`download ended early: ${bytes} of ${total} bytes`)
  return { sha256: hash.digest('hex'), bytes }
}

/** `ditto -x -k` on macOS (keeps the bundle's symlinks, modes and xattrs), `unzip` elsewhere. */
export function unzip(zipPath, destDir, platform = process.platform) {
  mkdirSync(destDir, { recursive: true })
  const [cmd, args] = platform === 'darwin' ? ['ditto', ['-x', '-k', zipPath, destDir]] : ['unzip', ['-q', '-o', zipPath, '-d', destDir]]
  const r = spawnSync(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'], encoding: 'utf8' })
  if (r.error) throw new Error(`${cmd} not found (${r.error.message})`)
  if (r.status !== 0) throw new Error(`${cmd} failed: ${(r.stderr || '').trim() || `exit ${r.status}`}`)
  return cmd
}

/** Removes com.apple.quarantine from the bundle if present. @returns {boolean} whether it was there */
export function stripQuarantine(bundle, platform = process.platform) {
  if (platform !== 'darwin') return false
  const has = spawnSync('xattr', ['-p', 'com.apple.quarantine', bundle], { stdio: 'ignore' }).status === 0
  if (has) spawnSync('xattr', ['-dr', 'com.apple.quarantine', bundle], { stdio: 'ignore' })
  return has
}

function launchApp(bundle, args, platform = process.platform) {
  if (platform !== 'darwin') return Promise.resolve({ launched: false })
  const openArgs = args.length ? [bundle, '--args', ...args] : [bundle]
  return new Promise((resolve, reject) => {
    const child = spawn('open', openArgs, { stdio: 'inherit' })
    child.on('error', reject)
    child.on('exit', (code) => (code === 0 ? resolve({ launched: true }) : reject(new Error(`open exited with ${code}`))))
  })
}

/** One line for the first run. bunx when running under Bun, else npx. */
export function uninstallHint(config, isBun = Boolean(/** @type {any} */ (process.versions).bun)) {
  return `remove it later with ${isBun ? 'bunx' : 'npx'} ${config.packageName} --uninstall`
}

/** @param {AppConfig} config */
export function helpText(config, packageVersion) {
  const cmd = config.id
  return `${config.displayName} launcher ${packageVersion}

Downloads ${config.displayName} from GitHub Releases on first run (cached in ~/.cache/${config.id}),
verifies its SHA-256, and opens it.

Usage
  npx ${config.packageName} [options] [-- app args]
  bunx ${config.packageName} [options]
  npx ${config.packageName}@1.2.3          run a specific release
  ${cmd} [options]                          after npm i -g ${config.packageName}

Options
  --latest        run the newest GitHub release instead of this package's version
  --path          print the cached .app path for the resolved version and exit
  --clear-cache   delete every cached download (${'$'}XDG_CACHE_HOME/${config.id} or ~/.cache/${config.id})
  --uninstall     delete the cached downloads and print what else is left (app data, bun/npm cache)
                  and how to remove it
  --uninstall --all, --purge
                  also delete ${config.displayName}'s own data (profile, settings${config.uninstall?.keychain?.length ? ', keychain item' : ''}); asks first
  -y, --yes       with --uninstall --all: don't ask
  --no-launch     download, verify and unpack, but don't open the app
  -v, --version   print the launcher version and the ${config.displayName} version it runs
  -h, --help      this help

Anything else (a URL, for example) is passed to the app.

Environment
  XDG_CACHE_HOME             cache base directory
  ${config.envPrefix}_CACHE_DIR    exact cache directory
  GITHUB_TOKEN               used for GitHub API calls (only --latest or an unknown checksum need them)
  NO_COLOR, CI               plain output
`
}

/**
 * @param {AppConfig} config
 * @param {{ argv?: string[], packageVersion: string, manifestPath?: string | URL, env?: Record<string, string | undefined>,
 *   platform?: string, arch?: string, stdout?: { write(s: string): unknown }, ui?: ReturnType<typeof createUI>,
 *   fetchImpl?: typeof fetch, signal?: AbortSignal, home?: string, isRunning?: () => boolean,
 *   confirm?: (q: string) => Promise<boolean>, keychainExists?: (s: string) => boolean | null,
 *   exec?: (cmd: string, args: string[]) => number | null }} opts  (home and the last four are test seams for --uninstall)
 * @returns {Promise<number>} exit code
 */
export async function run(config, opts) {
  const env = opts.env ?? process.env
  const platform = opts.platform ?? process.platform
  const arch = opts.arch ?? process.arch
  const stdout = opts.stdout ?? process.stdout
  const ui = opts.ui ?? createUI({ env })
  const fetchImpl = opts.fetchImpl ?? fetch
  const args = parseArgs(opts.argv ?? process.argv.slice(2))
  const userAgent = `${config.packageName}/${opts.packageVersion}`
  const home = tildify

  if (args.help) { stdout.write(helpText(config, opts.packageVersion)); return 0 }

  const request = resolveVersionRequest({ packageVersion: opts.packageVersion, latest: args.latest })
  if (args.version) {
    const runs = request.kind === 'pinned' ? `${config.displayName} v${request.version}` : `the latest ${config.displayName} release`
    stdout.write(`${config.packageName} ${opts.packageVersion} (runs ${runs})\n`)
    return 0
  }

  if (args.uninstall) {
    return runUninstall(config, { all: args.all, yes: args.yes, env, platform, ui, stdout, home: opts.home, isRunning: opts.isRunning, confirm: opts.confirm,
      keychainExists: opts.keychainExists, exec: opts.exec, dirSize, formatBytes })
  }

  if (args.clearCache) {
    const root = cacheRoot(config, env)
    if (root === '/' || !root.includes(config.id)) { ui.error(`refusing to delete ${root}`); return 1 }
    const size = dirSize(root)
    rmSync(root, { recursive: true, force: true })
    ui.step(`cleared ${home(root)} (${formatBytes(size)})`)
    return 0
  }

  const testOverride = Boolean(env[`${config.envPrefix}_ASSET_URL`])
  const unsupported = platformSupport(config, platform, arch)
  if (unsupported && !testOverride) {
    ui.line(unsupported)
    ui.line(`(${config.displayName} releases: https://github.com/${config.repo}/releases)`)
    return 1
  }
  if (unsupported) ui.warn(`${platform}-${arch}: no build, but ${config.envPrefix}_ASSET_URL is set (test mode, won't launch)`)

  // Pinned + cached: launch without touching the network at all.
  if (request.kind === 'pinned' && isCached(config, request.version, env) && !testOverride) {
    return finish(request.version, false)
  }

  // bunx without Node runs this under Bun, whose fetch can't use socks:// proxies (Node's ignores them)
  const socks = ['HTTPS_PROXY', 'https_proxy', 'ALL_PROXY', 'all_proxy'].map((k) => env[k]).find((v) => v && /^socks/i.test(v))
  if (socks && /** @type {any} */ (process.versions).bun) ui.warn(`Bun can't download through a SOCKS proxy (${socks.split('://')[0]}); if this fails, use npx or unset HTTPS_PROXY`)

  /** @type {Target} */
  let target
  try {
    target = await resolveTarget(config, request, { manifest: opts.manifestPath ? readManifest(opts.manifestPath) : null, env, fetchImpl, signal: opts.signal, userAgent })
  } catch (err) {
    const fallback = request.kind === 'latest' ? newestCached(config, env) : null
    if (fallback && !args.path) {
      ui.warn(`couldn't check for the latest release (${/** @type {Error} */ (err).message}); using cached v${fallback}`)
      return finish(fallback, false)
    }
    ui.error(/** @type {Error} */ (err).message)
    return 1
  }

  if (isCached(config, target.version, env) && !testOverride) return finish(target.version, false)
  if (args.path) {
    stdout.write(appPath(config, target.version, env) + '\n')
    ui.warn(`v${target.version} isn't downloaded yet`)
    return 1
  }
  if (!target.sha256 && !testOverride) {
    ui.error(`no SHA-256 is published for ${target.assetName}, so it can't be verified. Set ${config.envPrefix}_SHA256 to override.`)
    return 1
  }

  await install(target)
  return finish(target.version, true)

  /** Download + verify + unpack into the cache. */
  async function install(/** @type {Target} */ t) {
    const root = cacheRoot(config, env)
    mkdirSync(root, { recursive: true })
    const id = `${process.pid}-${randomBytes(4).toString('hex')}`
    const tmpZip = join(root, `.download-${id}.zip`)
    const staging = join(root, `.staging-${id}`)
    const finalDir = versionDir(config, t.version, env)
    const sizeHint = t.size ? formatBytes(t.size) : `~${config.approxSizeMB} MB`
    const cleanup = () => {
      rmSync(tmpZip, { force: true })
      rmSync(staging, { recursive: true, force: true })
    }
    const abort = new AbortController()
    const onSignal = () => abort.abort()
    process.once('SIGINT', onSignal)
    process.once('SIGTERM', onSignal)
    if (opts.signal) opts.signal.addEventListener('abort', onSignal, { once: true })

    const explainers = [
      `Fetching ${config.displayName} v${t.version} from GitHub Releases (${config.repo})`,
      `Cached in ${home(root)} so the next launch is instant`,
      `Next: verifying SHA-256 so you get the exact build CI produced`,
      `Then: unpacking with ${platform === 'darwin' ? 'ditto' : 'unzip'} to keep the app bundle intact`,
      `Ctrl+C stops cleanly; the partial file is deleted`,
    ]
    ui.header(`${config.displayName} v${t.version} · first launch of this version, downloading once (${sizeHint})`)
    try {
      const bar = ui.progress({ rotation: rotationLines(explainers, config.tips), label: `downloading ${t.url}` })
      let result
      let elapsedMs = 0
      try {
        result = await download(t.url, tmpZip, { signal: abort.signal, fetchImpl, userAgent, onProgress: (r, total) => bar.update(r, Number.isFinite(total) ? total : (t.size ?? NaN)) })
      } finally {
        elapsedMs = bar.done().elapsedMs
      }
      const secs = Math.max(elapsedMs / 1000, 0.001)
      ui.step(`downloaded ${formatBytes(result.bytes)} in ${formatDuration(secs)} (${formatBytes(result.bytes / secs)}/s)`)

      if (t.sha256) {
        // hashed while streaming, so this is just the comparison
        assertChecksum(result.sha256, t.sha256, t.assetName)
        ui.step(`verified sha256 ${result.sha256.slice(0, 12)}…${result.sha256.slice(-6)} (matches ${t.checksumSource})`)
      } else {
        ui.warn(`not verified: no checksum for this override (set ${config.envPrefix}_SHA256)`)
      }

      const stop = ui.spinner(`unpacking with ${platform === 'darwin' ? 'ditto' : 'unzip'}`)
      let tool
      try { tool = unzip(tmpZip, staging, platform) } finally { stop() }
      rmSync(tmpZip, { force: true })
      if (!existsSync(join(staging, config.appBundle))) {
        if (!testOverride) throw new Error(`${config.appBundle} isn't in ${t.assetName}`)
        ui.warn(`${config.appBundle} isn't in the zip (fine for a test asset)`)
      }
      writeFileSync(join(staging, MARKER), JSON.stringify({ version: t.version, sha256: result.sha256, url: t.url, installedAt: new Date().toISOString() }, null, 2))
      rmSync(finalDir, { recursive: true, force: true })
      try {
        renameSync(staging, finalDir) // atomic on the same filesystem
      } catch (err) {
        if (!isCached(config, t.version, env)) throw err // someone else won the race: use theirs
      }
      ui.step(`unpacked with ${tool} to ${home(finalDir)}`)
    } catch (err) {
      cleanup()
      if (abort.signal.aborted) {
        ui.restore()
        ui.warn('cancelled, partial download removed')
        throw Object.assign(new Error('cancelled'), { exitCode: 130 })
      }
      throw err
    } finally {
      process.off('SIGINT', onSignal)
      process.off('SIGTERM', onSignal)
      ui.restore()
    }
  }

  /** Launch (or print the path). */
  async function finish(version, fresh) {
    const bundle = appPath(config, version, env)
    if (args.path) { stdout.write(bundle + '\n'); return 0 }
    if (stripQuarantine(bundle, platform)) ui.step('removed the com.apple.quarantine flag (the app is unsigned)')
    if (args.noLaunch || platform !== 'darwin') {
      ui.step(`ready: ${home(bundle)}${platform !== 'darwin' ? ' (not launching: not macOS)' : ''}`)
      return 0
    }
    ui.next(`launching ${config.displayName} v${version}${fresh ? '' : ' (cached)'}`)
    await launchApp(bundle, args.passthrough, platform)
    if (fresh && config.firstRunNote) ui.info(config.firstRunNote.replace(/\n/g, '\n  '))
    if (fresh) ui.info(uninstallHint(config))
    return 0
  }
}

