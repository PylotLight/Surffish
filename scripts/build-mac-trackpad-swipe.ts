import { mkdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const isDevelopment = process.argv.includes('--dev')

if (process.platform !== 'darwin') {
  process.exit(0)
}

const source = join(root, 'native/macos/mac-trackpad-swipe.mm')
const outputDirectory = join(root, 'out/native')
const output = join(outputDirectory, 'mac-trackpad-swipe.node')
const headersPackage = Bun.resolveSync('node-api-headers/package.json', root)
const headersDirectory = join(dirname(headersPackage), 'include')
mkdirSync(outputDirectory, { recursive: true })

const result = spawnSync('xcrun', [
  'clang++',
  '-bundle',
  '-undefined',
  'dynamic_lookup',
  '-arch', 'arm64',
  '-arch', 'x86_64',
  '-mmacosx-version-min=13.0',
  '-fobjc-arc',
  '-std=c++20',
  '-O2',
  '-Wall',
  '-Wextra',
  '-I', headersDirectory,
  '-framework', 'AppKit',
  '-framework', 'QuartzCore',
  '-o', output,
  source
], { cwd: root, stdio: 'inherit' })

if (result.error || result.status !== 0) {
  const detail = result.error?.message ?? `clang exited with status ${result.status ?? 'unknown'}`
  if (isDevelopment) {
    console.warn(`[trackpad swipe] Native addon unavailable in this development run: ${detail}`)
    process.exit(0)
  }
  console.error(`[trackpad swipe] Native addon build failed: ${detail}`)
  process.exit(result.status || 1)
}

console.log(`[trackpad swipe] Built universal macOS addon: ${output}`)
