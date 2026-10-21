import { describe, expect, test } from 'bun:test'
import {
  canOfferReadAloud,
  DEFAULT_READ_ALOUD_SETTINGS,
  isCommandHiddenByReadAloud,
  isLoopbackSpeechEndpoint,
  isReadAloudActive,
  isReadAloudControl,
  downloadPercent,
  isReadAloudDownloadBusy,
  mergeTestStats,
  nearestSpeed,
  parseReadAloudSettings,
  parseReadAloudTestRequest,
  READ_ALOUD_SAMPLE_TEXT,
  READ_ALOUD_TEST_MAX_CHARS,
  realtimeFactor,
  speechEndpointUrl
} from './read-aloud'
import {
  firstUseDownloadBytes,
  formatDownloadSize,
  isPhononRuntimeFile,
  parseReadAloudTestManifest,
  PHONON_MANIFEST,
  PHONON_MODEL_ASSETS,
  PHONON_RUNTIME,
  READ_ALOUD_VOICES,
  readAloudVoice,
  speedToDurationDelta
} from './read-aloud-assets'

describe('read aloud settings', () => {
  test('off by default (experimental), Phonon engine, default voice, 1x', () => {
    expect(parseReadAloudSettings(null)).toEqual(DEFAULT_READ_ALOUD_SETTINGS)
    expect(DEFAULT_READ_ALOUD_SETTINGS.enabled).toBe(false)
    expect(DEFAULT_READ_ALOUD_SETTINGS.engine).toBe('phonon')
  })

  test('keeps valid fields, falls back on junk', () => {
    const parsed = parseReadAloudSettings({ enabled: true, engine: 'system', voice: 'NbpkqMVS3CJeq2j8', speed: 1.29, endpoint: 'http://localhost:8880/v1/', endpointVoice: '  alloy ' })
    expect(parsed).toEqual({ enabled: true, engine: 'system', voice: 'NbpkqMVS3CJeq2j8', speed: 1.3, endpoint: 'http://localhost:8880/v1', endpointVoice: 'alloy' })
    const junk = parseReadAloudSettings({ enabled: 'yes', engine: 'cloud', voice: '../nobody', speed: 'fast', endpoint: 'https://api.openai.com/v1' })
    expect(junk).toEqual(DEFAULT_READ_ALOUD_SETTINGS)
  })

  test('a change keeps the current settings for fields it leaves out', () => {
    const current = parseReadAloudSettings({ enabled: true, voice: 'X6NceqF285Gr04gb', speed: 1.15 })
    expect(parseReadAloudSettings({ speed: 0.8 }, current)).toEqual({ ...current, speed: 0.8 })
  })

  test('the speech endpoint must stay on this machine', () => {
    expect(isLoopbackSpeechEndpoint('http://127.0.0.1:8880/v1')).toBe(true)
    expect(isLoopbackSpeechEndpoint('http://[::1]:8880')).toBe(true)
    expect(isLoopbackSpeechEndpoint('https://api.openai.com/v1')).toBe(false)
    expect(isLoopbackSpeechEndpoint('http://user:pw@127.0.0.1:8880')).toBe(false)
    expect(isLoopbackSpeechEndpoint('file:///etc/passwd')).toBe(false)
    expect(speechEndpointUrl('http://127.0.0.1:8880/v1')).toBe('http://127.0.0.1:8880/v1/audio/speech')
    expect(speechEndpointUrl('http://127.0.0.1:8880/')).toBe('http://127.0.0.1:8880/v1/audio/speech')
    expect(speechEndpointUrl('http://10.0.0.2:8880/v1')).toBeNull()
  })
})

describe('speed', () => {
  test('snaps to the offered rates', () => {
    expect(nearestSpeed(1.4)).toBe(1.3)
    expect(nearestSpeed(9)).toBe(1.5)
    expect(nearestSpeed(Number.NaN)).toBe(1)
  })

  test('maps to Phonon duration_delta: 1x is neutral, faster is negative, bounded', () => {
    expect(speedToDurationDelta(1)).toBe(0)
    expect(speedToDurationDelta(1.5)).toBeLessThan(0)
    expect(speedToDurationDelta(0.8)).toBeGreaterThan(0)
    expect(speedToDurationDelta(1.5)).toBeGreaterThanOrEqual(-0.4)
    expect(speedToDurationDelta(1.3)).toBeLessThan(speedToDurationDelta(1.15))
  })
})

describe('download manifest', () => {
  test('pins the Apache-2.0 31M model, never the CC BY-NC 40M ones', () => {
    for (const asset of PHONON_MODEL_ASSETS) {
      expect(asset.url).toContain('huggingface.co/gradium/phonon-31m-en/resolve/8c64b55ec301728e2d1695bfea87a08a267d0c2d/')
      expect(asset.url).not.toContain('40m')
      expect(asset.sha256).toMatch(/^[0-9a-f]{64}$/)
    }
    for (const voice of READ_ALOUD_VOICES) {
      expect(voice.url).toMatch(/^https:\/\/huggingface\.co\/gradium\/phonon-(?:31m-en|voices)\/resolve\/[0-9a-f]{40}\//)
      expect(voice.sha256).toMatch(/^[0-9a-f]{64}$/)
    }
    expect(PHONON_MODEL_ASSETS.find((asset) => asset.file.endsWith('.gguf'))?.bytes).toBe(64512352)
  })

  test('the runtime is the official npm package, checked by its registry integrity', () => {
    expect(PHONON_RUNTIME.url).toBe('https://registry.npmjs.org/phonon-tts/-/phonon-tts-0.4.0.tgz')
    expect(PHONON_RUNTIME.integrity).toMatch(/^sha512-[A-Za-z0-9+/]+=*$/)
  })

  test('the model download is 71 MB (decimal units, like Finder)', () => {
    expect(firstUseDownloadBytes()).toBe(70976881)
    expect(formatDownloadSize(firstUseDownloadBytes())).toBe('71 MB')
    expect(formatDownloadSize(256136)).toBe('256 KB')
    expect(formatDownloadSize(5927575)).toBe('5.9 MB')
    expect(formatDownloadSize(0)).toBe('0 B')
  })

  test('the manifest bundles the pinned files', () => {
    expect(PHONON_MANIFEST.runtime).toBe(PHONON_RUNTIME)
    expect(PHONON_MANIFEST.model).toBe(PHONON_MODEL_ASSETS)
    expect(PHONON_MANIFEST.modelFolder).toBe('model')
  })

  test('smoke manifest: loopback fixtures with their own hashes only', () => {
    const sha = 'a'.repeat(64)
    const file = (name: string) => ({ url: `http://127.0.0.1:4000/${name}`, bytes: 10, sha256: sha })
    const valid = { runtime: { url: 'http://127.0.0.1:4000/rt.tgz', bytes: 100, integrity: 'sha512-abc=' }, model: { 'model.q8.gguf': file('m'), 'tokenizer.json': file('t'), 'config.json': file('c'), 'default-voice.safetensors': file('v') } }
    const parsed = parseReadAloudTestManifest(valid)
    expect(parsed?.model.map((asset) => asset.file)).toEqual(['model/model.q8.gguf', 'model/tokenizer.json', 'model/config.json', 'model/default-voice.safetensors'])
    expect(parsed?.voices.map((voice) => voice.id)).toEqual(['default'])
    expect(parseReadAloudTestManifest({ ...valid, runtime: { ...valid.runtime, url: 'https://evil.example/rt.tgz' } })).toBeNull()
    expect(parseReadAloudTestManifest({ ...valid, model: { ...valid.model, 'config.json': { ...file('c'), sha256: 'nope' } } })).toBeNull()
    expect(parseReadAloudTestManifest(null)).toBeNull()
  })

  test('unpacks only the JS and the Relaxed SIMD wasm builds, never paths outside the folder', () => {
    for (const path of ['index.js', 'worker.js', 'wasm/phonon_tts.js', 'wasm/phonon_tts_bg.wasm', 'wasm-threads/phonon_tts_bg.wasm', 'wasm-threads/snippets/wasm-bindgen-rayon-38edf6e439f6d70d/src/workerHelpers.js', 'LICENSE-MIT']) {
      expect(isPhononRuntimeFile(path)).toBe(true)
    }
    for (const path of ['wasm/phonon_tts_simd_bg.wasm', 'index.d.ts', 'README.md', 'package.json', '../evil.js', '/etc/x.js', 'wasm/../../x.js']) {
      expect(isPhononRuntimeFile(path)).toBe(false)
    }
  })

  test('voices: unknown ids fall back to the model voice', () => {
    expect(readAloudVoice('nope').id).toBe('default')
    expect(readAloudVoice('GgfEkEJtxZR7gnpy').name).toBe('Freya')
  })
})

describe('download state', () => {
  test('percent is whole, clamped and 0 while the total is unknown', () => {
    expect(downloadPercent(0, 0)).toBe(0)
    expect(downloadPercent(50, 0)).toBe(0)
    expect(downloadPercent(35_488_440, 70_976_881)).toBe(49)
    expect(downloadPercent(80, 70)).toBe(100)
  })
  test('checking and downloading are busy (Cancel shows)', () => {
    expect(isReadAloudDownloadBusy({ status: 'downloading' })).toBe(true)
    expect(isReadAloudDownloadBusy({ status: 'checking' })).toBe(true)
    expect(isReadAloudDownloadBusy({ status: 'ready' })).toBe(false)
    expect(isReadAloudDownloadBusy({ status: 'error' })).toBe(false)
  })
})

describe('voice tester', () => {
  test('requests: empty text speaks the sample, long text is capped, bad fields fall back', () => {
    expect(parseReadAloudTestRequest({ text: '   ' })).toEqual({ text: READ_ALOUD_SAMPLE_TEXT, engine: 'phonon', voice: 'default', speed: 1 })
    expect(parseReadAloudTestRequest({ text: 'x'.repeat(5000), engine: 'system', voice: 'GgfEkEJtxZR7gnpy', speed: 1.45 })).toEqual({ text: 'x'.repeat(READ_ALOUD_TEST_MAX_CHARS), engine: 'system', voice: 'GgfEkEJtxZR7gnpy', speed: 1.5 })
    expect(parseReadAloudTestRequest({ engine: 'shell', voice: '../x' })).toMatchObject({ engine: 'phonon', voice: 'default' })
    expect(parseReadAloudTestRequest('nope')).toBeNull()
  })
  test('real-time factor: compute seconds per audio second', () => {
    expect(realtimeFactor({ generateMs: 853, audioSeconds: 4.08 })).toBe(0.21)
    expect(realtimeFactor({ generateMs: null, audioSeconds: 4 })).toBeNull()
    expect(realtimeFactor({ generateMs: 100, audioSeconds: 0 })).toBeNull()
    expect(realtimeFactor(null)).toBeNull()
  })
  test('stats merge first-audio and final reports, ignoring junk', () => {
    const first = mergeTestStats(null, { loadMs: 987, cold: true, firstAudioMs: 100, threads: 2, device: 'wasm' })
    expect(first).toEqual({ loadMs: 987, cold: true, firstAudioMs: 100, audioSeconds: null, generateMs: null, threads: 2 })
    const final = mergeTestStats(first, { generateMs: 853, audioSeconds: 4.08, loadMs: -5, firstAudioMs: 'x' })
    expect(final).toEqual({ loadMs: 987, cold: true, firstAudioMs: 100, audioSeconds: 4.08, generateMs: 853, threads: 2 })
    expect(mergeTestStats(first, null)).toBe(first)
  })
})

describe('gating', () => {
  test('palette entries hide while off', () => {
    expect(isCommandHiddenByReadAloud('readAloud.page', false)).toBe(true)
    expect(isCommandHiddenByReadAloud('readAloud.page', true)).toBe(false)
    expect(isCommandHiddenByReadAloud('tab.new', false)).toBe(false)
  })

  test('menu entries: on, a web page, not a PDF', () => {
    expect(canOfferReadAloud({ enabled: true, url: 'https://example.com/a', pdf: false })).toBe(true)
    expect(canOfferReadAloud({ enabled: false, url: 'https://example.com/a', pdf: false })).toBe(false)
    expect(canOfferReadAloud({ enabled: true, url: 'https://example.com/a.pdf', pdf: true })).toBe(false)
    expect(canOfferReadAloud({ enabled: true, url: 'surffish://newtab', pdf: false })).toBe(false)
  })

  test('controls and active states', () => {
    expect(isReadAloudControl('next')).toBe(true)
    expect(isReadAloudControl('rm -rf')).toBe(false)
    expect(isReadAloudActive({ status: 'paused' })).toBe(true)
    expect(isReadAloudActive({ status: 'error' })).toBe(false)
    expect(isReadAloudActive({ status: 'idle' })).toBe(false)
  })
})
