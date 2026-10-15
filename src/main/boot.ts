// Main-process entry (out/main/index.js). Turns on Node's on-disk V8 compile cache before the ~1 MB
// app bundle (src/main/index.ts -> out/main/app.js) is parsed, so launches after the first reuse its
// bytecode instead of compiling it again. Node keys the cache on the file contents and its own
// version, so an update simply misses once. Kept tiny: nothing here benefits from the cache.
import { app } from 'electron'
import module from 'node:module'
import { join } from 'node:path'
import { compileCacheDirectoryFor, pruneOtherCompileCaches } from './compile-cache-dir'

// Same as APP_NAME in shared/config; not imported, so this entry shares no chunk with the app.
// Pre-release builds (X.Y.Z-beta.N, -nightly.N, ...) keep their own cache folder: the stable app and
// a beta prune every other version's cache, so sharing one folder would make them wipe each other's.
const PRERELEASE_WORD = /^\d+\.\d+\.\d+-([A-Za-z]+)/.exec(safeVersion())?.[1]?.toLowerCase()
const APP_NAME = !PRERELEASE_WORD ? 'Surffish' : `Surffish ${PRERELEASE_WORD === 'nightly' || PRERELEASE_WORD === 'alpha' ? PRERELEASE_WORD[0]!.toUpperCase() + PRERELEASE_WORD.slice(1) : 'Beta'}`

function safeVersion(): string {
  try {
    return app.getVersion()
  } catch {
    return ''
  }
}

/** The OS cache directory (purgeable, outside the profile, so dev and release builds share it safely). */
function compileCacheRoot(): string {
  if (process.platform === 'darwin') return join(app.getPath('home'), 'Library', 'Caches', APP_NAME, 'node-compile-cache')
  if (process.platform === 'linux') return join(process.env['XDG_CACHE_HOME'] || join(app.getPath('home'), '.cache'), APP_NAME, 'node-compile-cache')
  return join(app.getPath('temp'), APP_NAME, 'node-compile-cache')
}

// Read once: the version (and the root, from app paths) must be the same when pruning later.
function compileCacheTarget(): { root: string; version: string } | null {
  if (process.env['SURFFISH_NO_COMPILE_CACHE']) return null
  try {
    return { root: compileCacheRoot(), version: app.getVersion() }
  } catch {
    return null
  }
}

const compileCache = compileCacheTarget()

if (compileCache) {
  try {
    module.enableCompileCache?.(compileCacheDirectoryFor(compileCache.root, compileCache.version))
  } catch {
    // An unwritable cache directory only costs the speed-up.
  }
}

await import('./index')

// Node writes the cache at exit; also write what start-up compiled once it has settled, so a crash
// or a killed process still leaves a warm cache for the next launch. Then drop older versions' caches
// (and the pre-versioned layout), which nothing reads after an update.
setTimeout(() => {
  try {
    module.flushCompileCache?.()
  } catch {
    // Best effort.
  }
  if (compileCache) pruneOtherCompileCaches(compileCache.root, compileCache.version)
}, 15_000).unref?.()
