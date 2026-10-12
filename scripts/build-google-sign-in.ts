// Builds the native WebKit Google sign-in helper (macOS only).
import { mkdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
if (process.platform !== 'darwin') process.exit(0)

const source = join(root, 'src/native/macos/google-sign-in/main.swift')
const outputDirectory = join(root, 'out/native')
const output = join(outputDirectory, 'google-sign-in')
mkdirSync(outputDirectory, { recursive: true })

const result = spawnSync('xcrun', [
  'swiftc', '-O', '-swift-version', '5', '-parse-as-library',
  '-target', 'arm64-apple-macos13.0',
  '-framework', 'AppKit', '-framework', 'WebKit',
  '-o', output, source
], { cwd: root, stdio: 'inherit' })

if (result.status !== 0) {
  console.warn('[google sign-in] Swift helper failed to build; Google sign-in hand-off is unavailable in this run.')
  process.exit(process.argv.includes('--strict') ? 1 : 0)
}
console.log(`[google sign-in] built ${output}`)
