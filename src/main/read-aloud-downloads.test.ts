import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import type { ReadAloudDownloadState } from '../shared/read-aloud'
import type { ReadAloudManifest } from '../shared/read-aloud-assets'
import { createReadAloudDownloads, ReadAloudDownloadCancelled, readAloudDiskState, sumAssetBytes } from './read-aloud-downloads'

function tarEntry(name: string, body: string): Uint8Array[] {
  const data = new TextEncoder().encode(body)
  const header = new Uint8Array(512)
  header.set(new TextEncoder().encode(`package/${name}`), 0)
  header.set(new TextEncoder().encode(data.length.toString(8).padStart(11, '0')), 124)
  header[156] = '0'.charCodeAt(0)
  header.set(new TextEncoder().encode('ustar'), 257)
  const padded = new Uint8Array(Math.ceil(data.length / 512) * 512)
  padded.set(data)
  return [header, padded]
}

function tarGz(files: Record<string, string>): Uint8Array {
  const blocks = [...Object.entries(files).flatMap(([name, body]) => tarEntry(name, body)), new Uint8Array(1024)]
  const out = new Uint8Array(blocks.reduce((sum, block) => sum + block.length, 0))
  let offset = 0
  for (const block of blocks) {
    out.set(block, offset)
    offset += block.length
  }
  return gzipSync(out)
}

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')

const runtime = tarGz({ 'index.js': 'export const PhononTTS = {}', 'worker.js': '// worker', 'README.md': 'skipped' })
const files: Record<string, Uint8Array> = {
  'https://fixture.test/runtime.tgz': runtime,
  'https://fixture.test/model.gguf': new Uint8Array(200_000).fill(7),
  'https://fixture.test/tokenizer.json': new TextEncoder().encode('{"tokenizer":true}'),
  'https://fixture.test/voice-default': new Uint8Array(3000).fill(1),
  'https://fixture.test/voices/voices/freya.safetensors': new Uint8Array(4000).fill(2),
  'https://fixture.test/voices/voices.jsonl': new TextEncoder().encode([
    { voice_id: 'freya', name: 'Freya', language: 'en', locale: 'en-gb', gender: 'female', age: 'Adult', description: 'Bright.', filename: 'voices/freya.safetensors' },
    { voice_id: 'nele', name: 'Nele', language: 'de', locale: 'de-de', gender: 'female', age: 'Adult', description: 'German.', filename: 'voices/nele.safetensors' }
  ].map((line) => JSON.stringify(line)).join('\n'))
}
const catalogBytes = files['https://fixture.test/voices/voices.jsonl']!

const manifest: ReadAloudManifest = {
  runtimeVersion: 'test',
  runtime: { label: 'Phonon runtime', url: 'https://fixture.test/runtime.tgz', file: 'runtime.tgz', bytes: runtime.length, integrity: `sha512-${createHash('sha512').update(runtime).digest('base64')}` },
  model: [
    { label: 'Model weights', url: 'https://fixture.test/model.gguf', file: 'model/model.q8.gguf', bytes: 200_000, sha256: sha256(files['https://fixture.test/model.gguf']!) },
    { label: 'Tokenizer', url: 'https://fixture.test/tokenizer.json', file: 'model/tokenizer.json', bytes: files['https://fixture.test/tokenizer.json']!.length, sha256: sha256(files['https://fixture.test/tokenizer.json']!) },
    { label: 'Default voice', url: 'https://fixture.test/voice-default', file: 'model/default-voice.safetensors', bytes: 3000, sha256: sha256(files['https://fixture.test/voice-default']!) }
  ],
  catalog: {
    url: 'https://fixture.test/voices/voices.jsonl',
    sha256: sha256(catalogBytes),
    bytes: catalogBytes.length,
    base: 'https://fixture.test/voices',
    hashes: { freya: sha256(files['https://fixture.test/voices/voices/freya.safetensors']!), nele: 'b'.repeat(64) },
    voiceBytes: 4000
  },
  modelFolder: 'model'
}

interface FetchOptions {
  /** Status per url (default 200). */
  status?: Record<string, number>
  /** Serve different bytes than the manifest expects. */
  corrupt?: Set<string>
  /** Resolves when the test lets the stream continue past the first chunk. */
  gate?: Promise<void>
}

let directory: string
let requests: string[]
let states: ReadAloudDownloadState[]

function fakeFetch(options: FetchOptions = {}) {
  return async (url: string, init: RequestInit): Promise<Response> => {
    requests.push(url)
    const status = options.status?.[url] ?? 200
    if (status !== 200) return new Response('nope', { status })
    const source = files[url]!
    const bytes = options.corrupt?.has(url) ? source.map((byte) => byte ^ 0xff) : source
    const signal = init.signal as AbortSignal | undefined
    const chunk = 32 * 1024
    let offset = 0
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        if (signal?.aborted) {
          controller.error(new DOMException('aborted', 'AbortError'))
          return
        }
        if (offset > 0 && options.gate) await options.gate
        if (offset >= bytes.length) {
          controller.close()
          return
        }
        controller.enqueue(bytes.subarray(offset, offset + chunk))
        offset += chunk
      }
    })
    return new Response(body, { status: 200 })
  }
}

function manager(options: FetchOptions = {}) {
  return createReadAloudDownloads({
    directory: () => directory,
    fetch: fakeFetch(options),
    manifest: () => manifest,
    onState: (state) => states.push(state),
    progressIntervalMs: 0
  })
}

beforeEach(() => {
  directory = join(mkdtempSync(join(tmpdir(), 'read-aloud-dl-')), 'read-aloud')
  requests = []
  states = []
})

afterEach(() => {
  rmSync(join(directory, '..'), { recursive: true, force: true })
})

describe('model download', () => {
  test('fetches the runtime and model with progress, then is ready', async () => {
    const downloads = manager()
    expect(downloads.state().status).toBe('absent')
    await downloads.ensureModel()
    expect(downloads.state()).toMatchObject({ status: 'ready', bytes: sumAssetBytes(manifest), error: '', voices: ['default'] })
    expect(downloads.isReady()).toBe(true)
    const progress = states.filter((state) => state.status === 'downloading')
    expect(progress.length).toBeGreaterThan(3)
    const total = sumAssetBytes(manifest)
    expect(progress.every((state) => state.total === total)).toBe(true)
    expect(progress.map((state) => state.loaded)).toEqual([...progress.map((state) => state.loaded)].sort((a, b) => a - b))
    expect(progress.at(-1)?.loaded).toBe(total)
    expect(progress.map((state) => state.label)).toContain('Model weights')
    expect(existsSync(join(directory, 'ready.json'))).toBe(true)
    expect(readFileSync(join(directory, 'runtime/phonon-tts-test/index.js'), 'utf8')).toBe('export const PhononTTS = {}')
    expect(existsSync(join(directory, 'runtime/phonon-tts-test/README.md'))).toBe(false)
    expect(existsSync(join(directory, 'model/model.q8.gguf.partial'))).toBe(false)
  })

  test('a restart checks the cached files against their hashes and downloads nothing', async () => {
    await manager().ensureModel()
    requests = []
    states = []
    const restarted = manager()
    expect(restarted.state().status).toBe('ready')
    await restarted.ensureModel()
    expect(requests).toEqual([])
    expect(states.map((state) => state.status)).toEqual(['checking', 'ready'])
    // Verified once per run: a second call doesn't hash again.
    states = []
    await restarted.ensureModel()
    expect(states.map((state) => state.status)).toEqual(['ready'])
  })

  test('a file that no longer matches its hash is fetched again, alone', async () => {
    await manager().ensureModel()
    const tokenizer = join(directory, 'model/tokenizer.json')
    writeFileSync(tokenizer, Buffer.from(readFileSync(tokenizer, 'utf8').replace('true', 'fals')))
    const runtimeFile = join(directory, 'runtime/phonon-tts-test/worker.js')
    requests = []
    await manager().ensureModel()
    expect(requests).toEqual(['https://fixture.test/tokenizer.json'])
    writeFileSync(runtimeFile, 'tampered')
    requests = []
    await manager().ensureModel()
    expect(requests).toEqual(['https://fixture.test/runtime.tgz'])
  })

  test('cancel stops the download, keeps finished files, and Retry finishes it', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const downloads = manager({ gate })
    const run = downloads.ensureModel()
    while (!states.some((state) => state.status === 'downloading' && state.loaded > 0)) await Bun.sleep(1)
    downloads.cancel()
    release()
    await expect(run).rejects.toBeInstanceOf(ReadAloudDownloadCancelled)
    expect(downloads.state().status).toBe('cancelled')
    expect(existsSync(join(directory, 'ready.json'))).toBe(false)
    await downloads.ensureModel()
    expect(downloads.state().status).toBe('ready')
  })

  test('a failed file shows the error; Retry downloads what is still missing', async () => {
    const failing = manager({ status: { 'https://fixture.test/model.gguf': 503 } })
    await expect(failing.ensureModel()).rejects.toThrow('Model weights: download failed (HTTP 503)')
    expect(failing.state()).toMatchObject({ status: 'error', error: 'Model weights: download failed (HTTP 503)' })
    requests = []
    const retry = manager()
    await retry.ensureModel()
    expect(requests).toEqual(['https://fixture.test/model.gguf', 'https://fixture.test/tokenizer.json', 'https://fixture.test/voice-default'])
    expect(retry.state().status).toBe('ready')
  })

  test('a checksum mismatch is an error and leaves nothing behind', async () => {
    const downloads = manager({ corrupt: new Set(['https://fixture.test/tokenizer.json']) })
    await expect(downloads.ensureModel()).rejects.toThrow('Tokenizer: checksum mismatch')
    expect(existsSync(join(directory, 'model/tokenizer.json'))).toBe(false)
    expect(existsSync(join(directory, 'model/tokenizer.json.partial'))).toBe(false)
    expect(downloads.state().status).toBe('error')
  })

  test('a runtime tarball failing its npm integrity is refused', async () => {
    const downloads = manager({ corrupt: new Set(['https://fixture.test/runtime.tgz']) })
    await expect(downloads.ensureModel()).rejects.toThrow('Phonon runtime: checksum mismatch')
    expect(existsSync(join(directory, 'runtime/phonon-tts-test'))).toBe(false)
  })

  test('concurrent callers (enable + a reading) share one download', async () => {
    const downloads = manager()
    await Promise.all([downloads.ensureModel(), downloads.ensureModel()])
    expect(requests.filter((url) => url.endsWith('model.gguf')).length).toBe(1)
  })

  test('a blocked network (kill switch) is an error, nothing fetched', async () => {
    const downloads = createReadAloudDownloads({ directory: () => directory, fetch: fakeFetch(), manifest: () => manifest, onState: () => undefined, blockedReason: () => 'Blocked by the kill switch.' })
    await expect(downloads.ensureModel()).rejects.toThrow('Blocked by the kill switch.')
    expect(requests).toEqual([])
  })
})

describe('voices and deleting', () => {
  test('a voice downloads once with its own progress and joins the cached list', async () => {
    const downloads = manager()
    await downloads.ensureModel()
    states = []
    requests = []
    expect(await downloads.ensureVoice('freya')).toBe('freya')
    expect(requests).toEqual(['https://fixture.test/voices/voices.jsonl', 'https://fixture.test/voices/voices/freya.safetensors'])
    expect(states.some((state) => state.voice?.id === 'freya' && state.voice.total === 4000)).toBe(true)
    expect(downloads.state()).toMatchObject({ voice: null, voices: ['default', 'freya'], status: 'ready' })
    requests = []
    expect(await downloads.ensureVoice('freya')).toBe('freya')
    expect(await downloads.ensureVoice('default')).toBe('default')
    // Not in the catalog (or not English): the model voice, nothing fetched.
    expect(await downloads.ensureVoice('unknown')).toBe('default')
    expect(await downloads.ensureVoice('nele')).toBe('default')
    expect(requests).toEqual([])
  })

  test('the voice catalog: English only, fetched once, then read from the profile', async () => {
    const downloads = manager()
    await downloads.ensureModel()
    requests = []
    const [first, second] = await Promise.all([downloads.ensureCatalog(), downloads.ensureCatalog()])
    expect(first!.map((voice) => [voice.id, voice.accent, voice.url])).toEqual([['freya', 'uk', 'https://fixture.test/voices/voices/freya.safetensors']])
    expect(second).toBe(first)
    expect(requests).toEqual(['https://fixture.test/voices/voices.jsonl'])
    requests = []
    expect((await manager().ensureCatalog()).map((voice) => voice.id)).toEqual(['freya'])
    expect(requests).toEqual([])
  })

  test('a catalog that fails its hash is refused', async () => {
    const downloads = manager({ corrupt: new Set(['https://fixture.test/voices/voices.jsonl']) })
    await downloads.ensureModel()
    await expect(downloads.ensureCatalog()).rejects.toThrow('Voice list: checksum mismatch')
    await expect(downloads.ensureVoice('freya')).rejects.toThrow('Voice list: checksum mismatch')
  })

  test('Delete download removes the folder; the disk state follows', async () => {
    const downloads = manager()
    await downloads.ensureModel()
    expect(readAloudDiskState(directory, manifest, 1).status).toBe('ready')
    await downloads.deleteAll()
    expect(existsSync(directory)).toBe(false)
    expect(downloads.state()).toMatchObject({ status: 'absent', voices: [] })
    expect(downloads.isReady()).toBe(false)
    expect(readAloudDiskState(directory, manifest, 1).status).toBe('absent')
  })
})
