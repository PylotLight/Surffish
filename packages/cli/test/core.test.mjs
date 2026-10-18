import { describe, expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import config from '../app.config.mjs'
import {
  appPath, assertChecksum, cacheRoot, findInChecksumList, normalizeVersion, parseArgs, parseSha256,
  platformSupport, releaseAssetUrl, resolveVersionRequest, sha256File, tildify,
} from '../lib/core.mjs'

const HELLO_SHA = '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824' // sha256("hello")

describe('version resolution', () => {
  test('the package version is the default', () => {
    expect(resolveVersionRequest({ packageVersion: '0.1.22' })).toEqual({ kind: 'pinned', version: '0.1.22' })
  })
  test('--latest wins over the package version', () => {
    expect(resolveVersionRequest({ packageVersion: '0.1.22', latest: true })).toEqual({ kind: 'latest', reason: 'flag' })
  })
  test('an unpublished dev copy asks for the latest release', () => {
    expect(resolveVersionRequest({ packageVersion: '0.0.0-dev' })).toEqual({ kind: 'latest', reason: 'dev' })
    expect(resolveVersionRequest({ packageVersion: 'garbage' })).toEqual({ kind: 'latest', reason: 'dev' })
  })
  test('prereleases stay pinned', () => {
    expect(resolveVersionRequest({ packageVersion: '0.2.0-beta.1' })).toEqual({ kind: 'pinned', version: '0.2.0-beta.1' })
  })
  test('normalizeVersion strips the v', () => {
    expect(normalizeVersion('v0.1.22')).toBe('0.1.22')
    expect(normalizeVersion(' 1.2.3 ')).toBe('1.2.3')
    expect(normalizeVersion('1.2')).toBeNull()
    expect(normalizeVersion(undefined)).toBeNull()
  })
})

describe('checksums', () => {
  test('parses GitHub digests and bare hex', () => {
    expect(parseSha256(`sha256:${HELLO_SHA.toUpperCase()}`)).toBe(HELLO_SHA)
    expect(parseSha256(HELLO_SHA)).toBe(HELLO_SHA)
    expect(parseSha256('sha512:abc')).toBeNull()
    expect(parseSha256('')).toBeNull()
  })
  test('finds a file in a SHA256SUMS listing', () => {
    const list = `${'a'.repeat(64)}  other.zip\n${HELLO_SHA} *Surffish-0.1.22-mac-arm64.zip\n`
    expect(findInChecksumList(list, 'Surffish-0.1.22-mac-arm64.zip')).toBe(HELLO_SHA)
    expect(findInChecksumList(list, 'missing.zip')).toBeNull()
  })
  test('hashes a file and verifies it', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'cli-test-')), 'f')
    writeFileSync(file, 'hello')
    const actual = await sha256File(file)
    expect(actual).toBe(HELLO_SHA)
    expect(assertChecksum(actual, `sha256:${HELLO_SHA}`)).toBe(true)
  })
  test('a mismatch throws with both values', () => {
    expect(() => assertChecksum(HELLO_SHA, 'b'.repeat(64), 'x.zip')).toThrow(/SHA-256 mismatch for x\.zip[\s\S]*expected b{64}[\s\S]*got +2cf24d/)
    expect(() => assertChecksum(HELLO_SHA, null)).toThrow(/missing or malformed/)
  })
})

describe('cache path', () => {
  test('defaults to ~/.cache/surffish', () => {
    expect(cacheRoot(config, {}, '/Users/me')).toBe('/Users/me/.cache/surffish')
    expect(appPath(config, '0.1.22', {}, '/Users/me')).toBe('/Users/me/.cache/surffish/0.1.22/Surffish.app')
  })
  test('respects XDG_CACHE_HOME (absolute only)', () => {
    expect(cacheRoot(config, { XDG_CACHE_HOME: '/x/cache' }, '/Users/me')).toBe('/x/cache/surffish')
    expect(cacheRoot(config, { XDG_CACHE_HOME: 'relative' }, '/Users/me')).toBe('/Users/me/.cache/surffish')
  })
  test('the exact-dir override wins', () => {
    expect(cacheRoot(config, { SURFFISH_CLI_CACHE_DIR: '/tmp/c', XDG_CACHE_HOME: '/x' }, '/h')).toBe('/tmp/c')
  })
  test('tildify', () => {
    expect(tildify('/Users/me/.cache/surffish', '/Users/me')).toBe('~/.cache/surffish')
    expect(tildify('/Users/meow/x', '/Users/me')).toBe('/Users/meow/x')
  })
})

describe('config + platform', () => {
  test('asset URL matches the release workflow + Cask naming', () => {
    expect(releaseAssetUrl(config, '0.1.22')).toBe('https://github.com/PylotLight/Surffish/releases/download/v0.1.22/Surffish-0.1.22-mac-arm64.zip')
  })
  test('only darwin-arm64 is supported', () => {
    expect(platformSupport(config, 'darwin', 'arm64')).toBeNull()
    expect(platformSupport(config, 'darwin', 'x64')).toMatch(/Apple silicon/)
    expect(platformSupport(config, 'win32', 'x64')).toMatch(/windows-build\.yml/)
    expect(platformSupport(config, 'linux', 'arm64')).toMatch(/no Linux build/)
    expect(platformSupport(config, 'freebsd', 'x64')).toMatch(/macOS on Apple silicon/)
  })
  test('parseArgs keeps app args', () => {
    const a = parseArgs(['--latest', 'https://example.com', '--no-launch', '--', '--version'])
    expect(a.latest).toBe(true)
    expect(a.noLaunch).toBe(true)
    expect(a.version).toBe(false)
    expect(a.passthrough).toEqual(['https://example.com', '--version'])
  })
})
