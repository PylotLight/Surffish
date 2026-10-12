import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const script = join(root, 'scripts', 'render-cask.ts')
const shaArm = 'a'.repeat(64)
const shaIntel = 'b'.repeat(64)

function render(args: string[]) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: root,
    encoding: 'utf8'
  })
}

test('renders version and architecture-specific SHA-256 values into the Cask', () => {
  const result = render([
    '--version', '1.2.3-beta.1',
    '--sha256-arm', shaArm,
    '--sha256-intel', shaIntel
  ])

  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /version "1\.2\.3-beta\.1"/)
  assert.match(result.stdout, new RegExp(`sha256 arm:\\s+"${shaArm}",\\s+intel: "${shaIntel}"`))
  assert.match(result.stdout, /Surffish-#\{version\}-mac-#\{arch\}\.zip/)
  assert.equal(result.stdout.includes('{{'), false)
})

test('rejects unsafe versions and malformed SHA-256 values', () => {
  const unsafeVersion = render([
    '--version', '1.2.3/../../other',
    '--sha256-arm', shaArm,
    '--sha256-intel', shaIntel
  ])
  assert.notEqual(unsafeVersion.status, 0)
  assert.match(unsafeVersion.stderr, /must be semver/)

  const malformedHash = render([
    '--version', '1.2.3',
    '--sha256-arm', shaArm.toUpperCase(),
    '--sha256-intel', shaIntel
  ])
  assert.notEqual(malformedHash.status, 0)
  assert.match(malformedHash.stderr, /lowercase 64-character SHA-256/)
})

test('writes a rendered Cask when an output path is supplied', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'surffish-render-cask-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const output = join(directory, 'Casks', 'surffish.rb')

  const result = render([
    '--version', '0.1.0',
    '--sha256-arm', shaArm,
    '--sha256-intel', shaIntel,
    '--out', output
  ])

  assert.equal(result.status, 0, result.stderr)
  const cask = readFileSync(output, 'utf8')
  assert.match(cask, /version "0\.1\.0"/)
  assert.equal(cask.includes('{{'), false)
})
