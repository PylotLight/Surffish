import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import { isPhononRuntimeFile } from '../shared/read-aloud-assets'
import { matchesIntegrity, readTar, readTarGz, sha256Hex } from './read-aloud-tar'

function header(name: string, size: number, type = '0', prefix = ''): Uint8Array {
  const block = new Uint8Array(512)
  const encoder = new TextEncoder()
  block.set(encoder.encode(name), 0)
  block.set(encoder.encode(size.toString(8).padStart(11, '0')), 124)
  block[156] = type.charCodeAt(0)
  block.set(encoder.encode('ustar'), 257)
  if (prefix) block.set(encoder.encode(prefix), 345)
  return block
}

function entry(name: string, body: string | Uint8Array, type = '0', prefix = ''): Uint8Array[] {
  const data = typeof body === 'string' ? new TextEncoder().encode(body) : body
  const padded = new Uint8Array(Math.ceil(data.length / 512) * 512)
  padded.set(data)
  return [header(name, data.length, type, prefix), padded]
}

function archive(...parts: Uint8Array[][]): Uint8Array {
  const blocks = [...parts.flat(), new Uint8Array(1024)]
  const out = new Uint8Array(blocks.reduce((sum, block) => sum + block.length, 0))
  let offset = 0
  for (const block of blocks) {
    out.set(block, offset)
    offset += block.length
  }
  return out
}

describe('readTar', () => {
  test('unpacks package/ files the filter keeps, skipping the rest', () => {
    const tar = archive(
      entry('package/index.js', 'export {}'),
      entry('package/README.md', '# readme'),
      entry('package/wasm/phonon_tts_bg.wasm', new Uint8Array(700).fill(7)),
      entry('package/wasm/phonon_tts_simd_bg.wasm', 'skip me'),
      entry('package/evil', '', '5'),
      entry('other/index.js', 'not in package/')
    )
    const files = readTar(tar, isPhononRuntimeFile)
    expect(files.map((file) => file.path)).toEqual(['index.js', 'wasm/phonon_tts_bg.wasm'])
    expect(new TextDecoder().decode(files[0]!.data)).toBe('export {}')
    expect(files[1]!.data.length).toBe(700)
    expect(files[1]!.data.every((byte) => byte === 7)).toBe(true)
  })

  test('honours ustar prefixes, pax paths and GNU long names', () => {
    const pax = '30 path=package/wasm/phonon_tts.js\n'
    const tar = archive(
      entry('src/workerHelpers.js', 'w', '0', 'package/wasm-threads/snippets/wasm-bindgen-rayon-38edf6e439f6d70d'),
      entry('PaxHeader', pax, 'x'),
      entry('short', 'p'),
      entry('././@LongLink', 'package/worker.js\0', 'L'),
      entry('trunc', 'l')
    )
    expect(readTar(tar, isPhononRuntimeFile).map((file) => file.path)).toEqual([
      'wasm-threads/snippets/wasm-bindgen-rayon-38edf6e439f6d70d/src/workerHelpers.js',
      'wasm/phonon_tts.js',
      'worker.js'
    ])
  })

  test('refuses paths that would escape the folder, and truncated archives', () => {
    const tar = archive(entry('package/../../evil.js', 'x'))
    expect(readTar(tar, isPhononRuntimeFile)).toEqual([])
    const truncated = archive(entry('package/index.js', 'x'.repeat(600))).subarray(0, 700)
    expect(() => readTar(truncated, () => true)).toThrow('truncated')
  })

  test('readTarGz gunzips first', () => {
    const files = readTarGz(gzipSync(archive(entry('package/index.js', 'ok'))), () => true)
    expect(files.map((file) => file.path)).toEqual(['index.js'])
  })
})

test('integrity and sha256 checks', () => {
  const bytes = new TextEncoder().encode('phonon')
  const integrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`
  expect(matchesIntegrity(bytes, integrity)).toBe(true)
  expect(matchesIntegrity(new TextEncoder().encode('phonon!'), integrity)).toBe(false)
  expect(matchesIntegrity(bytes, 'md5-abc')).toBe(false)
  expect(sha256Hex(bytes)).toBe(createHash('sha256').update(bytes).digest('hex'))
})
