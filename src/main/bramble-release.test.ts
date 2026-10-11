import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  downloadVerifiedBrambleFirefoxRelease,
  extractBrambleFirefoxArchive,
  selectLatestBrambleFirefoxRelease
} from './bramble-release.ts'

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function zipCrc32(bytes: Buffer): number {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function storedZip(files: Record<string, string>): Buffer {
  const localRecords: Buffer[] = []
  const centralRecords: Buffer[] = []
  let localOffset = 0
  for (const [name, text] of Object.entries(files)) {
    const filename = Buffer.from(name, 'utf8')
    const data = Buffer.from(text, 'utf8')
    const crc = zipCrc32(data)
    const local = Buffer.alloc(30 + filename.length)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x0800, 6)
    local.writeUInt16LE(0, 8)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(filename.length, 26)
    filename.copy(local, 30)
    localRecords.push(local, data)

    const central = Buffer.alloc(46 + filename.length)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(0x0314, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0x0800, 8)
    central.writeUInt16LE(0, 10)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(data.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(filename.length, 28)
    central.writeUInt32LE((0o100600 << 16) >>> 0, 38)
    central.writeUInt32LE(localOffset, 42)
    filename.copy(central, 46)
    centralRecords.push(central)
    localOffset += local.length + data.length
  }
  const centralDirectory = Buffer.concat(centralRecords)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(Object.keys(files).length, 8)
  eocd.writeUInt16LE(Object.keys(files).length, 10)
  eocd.writeUInt32LE(centralDirectory.length, 12)
  eocd.writeUInt32LE(localOffset, 16)
  return Buffer.concat([...localRecords, centralDirectory, eocd])
}

function githubRelease(version: string, archive: Buffer, checksums: Buffer): Record<string, unknown> {
  const tag = `${version}-firefox`
  const zipName = `bramble_firefox_${version}.zip`
  const root = `https://github.com/flythenimbus/bramble/releases/download/${tag}`
  return {
    tag_name: tag,
    draft: false,
    prerelease: false,
    assets: [
      { name: zipName, size: archive.length, digest: `sha256:${sha256(archive)}`, browser_download_url: `${root}/${zipName}` },
      { name: 'SHA256SUMS', size: checksums.length, digest: `sha256:${sha256(checksums)}`, browser_download_url: `${root}/SHA256SUMS` }
    ]
  }
}

function mockReleaseFetch(release: Record<string, unknown>, archive: Buffer, checksums: Buffer): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input)
    if (url.includes('/releases?per_page=100')) return new Response(JSON.stringify([release]), { status: 200, headers: { 'content-type': 'application/json' } })
    if (url.endsWith('.zip')) {
      const body = new Uint8Array(archive.length)
      body.set(archive)
      return new Response(body.buffer, { status: 200, headers: { 'content-length': String(archive.length) } })
    }
    if (url.endsWith('/SHA256SUMS')) return new Response(checksums.toString('utf8'), { status: 200, headers: { 'content-length': String(checksums.length) } })
    throw new Error(`Unexpected fetch in test: ${url}`)
  }) as typeof fetch
}

test('selects the newest stable Firefox release, not Chromium or a draft', () => {
  const archive = Buffer.from('zip')
  const sums = Buffer.from('checksums')
  const release127 = githubRelease('1.27.1', archive, sums)
  const release128 = githubRelease('1.28.0', archive, sums)
  const release129Draft = { ...githubRelease('1.29.0', archive, sums), draft: true }
  const chromium = { ...githubRelease('9.99.0', archive, sums), tag_name: '9.99.0-chromium' }
  const selected = selectLatestBrambleFirefoxRelease([release127, release128, release129Draft, chromium])
  assert.equal(selected.version, '1.28.0')
  assert.equal(selected.tag, '1.28.0-firefox')
  assert.equal(selected.githubDigest, sha256(archive))
})

test('rejects release assets whose URL is not the exact official Bramble GitHub path', () => {
  const archive = Buffer.from('zip')
  const sums = Buffer.from('checksums')
  const release = githubRelease('1.28.0', archive, sums)
  const assets = release.assets as Array<Record<string, unknown>>
  assets[0]!.browser_download_url = 'https://attacker.invalid/bramble.zip'
  assert.throws(() => selectLatestBrambleFirefoxRelease([release]), /unexpected download URL/)
})

test('downloads a release only when SHA256SUMS and GitHub asset digests agree', async () => {
  const archive = storedZip({ 'manifest.json': '{"name":"Bramble","version":"1.28.0"}', 'popup.html': '<!doctype html>' })
  const sums = Buffer.from(`${sha256(archive)}  bramble_firefox_1.28.0.zip\n`)
  const release = githubRelease('1.28.0', archive, sums)
  const verified = await downloadVerifiedBrambleFirefoxRelease(mockReleaseFetch(release, archive, sums))
  assert.equal(verified.sha256, sha256(archive))
  assert.equal(verified.release.version, '1.28.0')

  const wrongSums = Buffer.from(`${'0'.repeat(64)}  bramble_firefox_1.28.0.zip\n`)
  const wrongChecksumRelease = githubRelease('1.28.0', archive, wrongSums)
  await assert.rejects(downloadVerifiedBrambleFirefoxRelease(mockReleaseFetch(wrongChecksumRelease, archive, wrongSums)), /did not match its published SHA256SUMS/)
})

test('extracts a valid release ZIP and rejects path traversal entries', () => {
  const directory = mkdtempSync(join(tmpdir(), 'surffish-bramble-zip-test-'))
  try {
    const archive = storedZip({ 'manifest.json': '{"name":"Bramble","version":"1.28.0"}', 'nested/popup.html': '<main>vault</main>' })
    extractBrambleFirefoxArchive(archive, join(directory, 'valid'))
    assert.equal(JSON.parse(readFileSync(join(directory, 'valid', 'manifest.json'), 'utf8')).version, '1.28.0')
    assert.equal(readFileSync(join(directory, 'valid', 'nested', 'popup.html'), 'utf8'), '<main>vault</main>')

    const traversal = storedZip({ 'manifest.json': '{}', '../outside.txt': 'not outside' })
    assert.throws(() => extractBrambleFirefoxArchive(traversal, join(directory, 'invalid')), /path traversal/)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
