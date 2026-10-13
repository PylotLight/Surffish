// Main-process entry (out/main/index.js). Turns on Node's on-disk V8 compile cache before the ~1 MB
// app bundle (src/main/index.ts -> out/main/app.js) is parsed, so launches after the first reuse its
// bytecode instead of compiling it again. Node keys the cache on the file contents and its own
// version, so an update simply misses once. Kept tiny: nothing here benefits from the cache.
import { app } from 'electron'
import module from 'node:module'
import { join } from 'node:path'

// Same as APP_NAME in shared/config; not imported, so this entry shares no chunk with the app.
const APP_NAME = 'Surffish'

/** The OS cache directory (purgeable, outside the profile, so dev and release builds share it safely). */
function compileCacheDirectory(): string {
  if (process.platform === 'darwin') return join(app.getPath('home'), 'Library', 'Caches', APP_NAME, 'node-compile-cache')
  if (process.platform === 'linux') return join(process.env['XDG_CACHE_HOME'] || join(app.getPath('home'), '.cache'), APP_NAME, 'node-compile-cache')
  return join(app.getPath('temp'), APP_NAME, 'node-compile-cache')
}

if (!process.env['SURFFISH_NO_COMPILE_CACHE']) {
  try {
    module.enableCompileCache?.(compileCacheDirectory())
  } catch {
    // An unwritable cache directory only costs the speed-up.
  }
}

await import('./index')

// Node writes the cache at exit; also write what start-up compiled once it has settled, so a crash
// or a killed process still leaves a warm cache for the next launch.
setTimeout(() => {
  try {
    module.flushCompileCache?.()
  } catch {
    // Best effort.
  }
}, 15_000).unref?.()
