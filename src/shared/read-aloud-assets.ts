/**
 * Read Aloud downloads: the pinned Phonon runtime (official `phonon-tts` npm package), the Phonon 31M
 * English model and its voices, each checked against the hash below before use. Only the read-aloud
 * module and the Read Aloud settings chunk import this, so none of it is parsed at launch.
 */
import { ENGLISH_VOICE_SHA256, VOICE_CATALOG_BYTES, VOICE_CATALOG_SHA256, VOICE_CATALOG_URL, VOICE_FILE_BYTES, VOICES_REPO } from './read-aloud-voices'

const MODEL_REPO = 'https://huggingface.co/gradium/phonon-31m-en/resolve/8c64b55ec301728e2d1695bfea87a08a267d0c2d'

/** The checkpoint's own voice, part of the model download. */
export const DEFAULT_VOICE_FILE = 'default-voice.safetensors'
const DEFAULT_VOICE_SHA256 = 'f739e8c4c76ee7f92e7c94a82002748c8cd22e99582ac49f7b9b94cd63786e18'

/**
 * Where the voice catalog comes from: voices.jsonl (checked by sha256) and the voice files under
 * `base`, each checked against `hashes` (read-aloud-voices.ts). Fetched when a picker first opens.
 */
export interface VoiceCatalogSource {
  url: string
  sha256: string
  bytes: number
  base: string
  hashes: Readonly<Record<string, string>>
  voiceBytes: number
}

export const PHONON_VOICE_CATALOG: VoiceCatalogSource = {
  url: VOICE_CATALOG_URL,
  sha256: VOICE_CATALOG_SHA256,
  bytes: VOICE_CATALOG_BYTES,
  base: VOICES_REPO,
  hashes: ENGLISH_VOICE_SHA256,
  voiceBytes: VOICE_FILE_BYTES
}

/** One file of the first-use download, checked against `sha256` (or the npm `integrity`) before use. */
export interface ReadAloudAsset {
  /** What the progress line calls it. */
  label: string
  url: string
  /** Where it lands under the read-aloud folder. */
  file: string
  bytes: number
  sha256?: string
  /** npm's Subresource Integrity string for the package tarball. */
  integrity?: string
}

/**
 * The official browser build (gradium-ai/xn-ptts ptts-wasm, MIT OR Apache-2.0), straight from the
 * npm registry. Only the JS and the Relaxed SIMD builds are unpacked: Electron's Chromium has
 * Relaxed SIMD, so the plain-SIMD fallbacks for Safari are skipped.
 */
export const PHONON_RUNTIME_VERSION = '0.4.0'
export const PHONON_RUNTIME: ReadAloudAsset = {
  label: 'Phonon runtime',
  url: `https://registry.npmjs.org/phonon-tts/-/phonon-tts-${PHONON_RUNTIME_VERSION}.tgz`,
  file: `phonon-tts-${PHONON_RUNTIME_VERSION}.tgz`,
  bytes: 5927575,
  integrity: 'sha512-008+bytDUgx2npm+KXJV4Quo8BTXeRVLiYkX4mXPcToy81RQ2cu3Vvi2bdRjFZdpyaWfDy574w4bIZnGqRd44g=='
}

/** Files unpacked from the package (paths inside the tarball, without the `package/` prefix). */
export function isPhononRuntimeFile(path: string): boolean {
  if (/(?:^|\/)\.\.?(?:\/|$)/.test(path) || path.startsWith('/')) return false
  if (/^[a-z]+\.js$/.test(path) || /^LICENSE-(?:MIT|APACHE)$/.test(path)) return true
  if (/^wasm(?:-threads)?\/phonon_tts\.js$/.test(path) || /^wasm(?:-threads)?\/phonon_tts_bg\.wasm$/.test(path)) return true
  return /^wasm-threads\/snippets\/[\w.-]+\/src\/[\w.-]+\.js$/.test(path)
}

/** Phonon 31M English (gradium/phonon-31m-en, Apache-2.0), q8 weights, pinned to a commit. */
export const PHONON_MODEL_ASSETS: readonly ReadAloudAsset[] = [
  { label: 'Model weights', url: `${MODEL_REPO}/model.q8.gguf`, file: 'model/model.q8.gguf', bytes: 64512352, sha256: 'a7d9aad2cd6dc66473f24a08bc6d2939030ef4d751ef82349361fbef3272dbae' },
  { label: 'Tokenizer', url: `${MODEL_REPO}/tokenizer.json`, file: 'model/tokenizer.json', bytes: 277967, sha256: '691a00068fa7b989f2f3e5ae5daa2d1a5bb319f2d5360deafcfb19a8bb6e7936' },
  { label: 'Model config', url: `${MODEL_REPO}/config.json`, file: 'model/config.json', bytes: 2851, sha256: '7062ea376e6b158543c8abec8e5af67df171c49ad70eb7e2a0fb25c16f265e06' },
  { label: 'Default voice', url: `${MODEL_REPO}/${DEFAULT_VOICE_FILE}`, file: `model/${DEFAULT_VOICE_FILE}`, bytes: 256136, sha256: DEFAULT_VOICE_SHA256 }
]

/** Bytes the first Read Aloud downloads (runtime + model + default voice). */
export function firstUseDownloadBytes(): number {
  return PHONON_RUNTIME.bytes + PHONON_MODEL_ASSETS.reduce((sum, asset) => sum + asset.bytes, 0)
}

/** Decimal units, like Finder: the model download is "71 MB". */
export function formatDownloadSize(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(bytes >= 10_000_000 ? 0 : 1)} MB`
  if (bytes >= 1000) return `${Math.round(bytes / 1000)} KB`
  return `${Math.max(0, Math.round(bytes))} B`
}

/** Everything the model download fetches, in one place (main can swap it for a smoke-test manifest). */
export interface ReadAloudManifest {
  runtimeVersion: string
  runtime: ReadAloudAsset
  model: readonly ReadAloudAsset[]
  /** The voice catalog (null: only the model's own voice). */
  catalog: VoiceCatalogSource | null
  /** Folder under the read-aloud folder the model files (and voices/) live in. */
  modelFolder: string
}

export const PHONON_MANIFEST: ReadAloudManifest = {
  runtimeVersion: PHONON_RUNTIME_VERSION,
  runtime: PHONON_RUNTIME,
  model: PHONON_MODEL_ASSETS,
  catalog: PHONON_VOICE_CATALOG,
  modelFolder: 'model'
}

function testAsset(value: unknown, file: string): ReadAloudAsset | null {
  if (typeof value !== 'object' || value === null) return null
  const raw = value as Record<string, unknown>
  if (typeof raw.url !== 'string' || !/^http:\/\/127\.0\.0\.1:\d+\//.test(raw.url)) return null
  if (typeof raw.bytes !== 'number' || !(raw.bytes > 0)) return null
  const asset: ReadAloudAsset = { label: typeof raw.label === 'string' ? raw.label : file, url: raw.url, file, bytes: raw.bytes }
  if (typeof raw.integrity === 'string') asset.integrity = raw.integrity
  else if (typeof raw.sha256 === 'string' && /^[0-9a-f]{64}$/.test(raw.sha256)) asset.sha256 = raw.sha256
  else return null
  return asset
}

/**
 * Smoke tests only (main honors it in unpackaged runs): the same files, served by the smoke's own
 * 127.0.0.1 server with their own hashes, so CI exercises progress, cancel, retry and the cache
 * without the 71 MB download. Anything malformed or pointing elsewhere is refused (null). An optional
 * `catalog` ({ url, sha256, bytes, base, hashes }) stands in for voices.jsonl and its voice files.
 */
export function parseReadAloudTestManifest(value: unknown): ReadAloudManifest | null {
  if (typeof value !== 'object' || value === null) return null
  const raw = value as Record<string, unknown>
  const runtime = testAsset(raw.runtime, `phonon-tts-test.tgz`)
  if (!runtime || !runtime.integrity) return null
  const names = ['model.q8.gguf', 'tokenizer.json', 'config.json', 'default-voice.safetensors'] as const
  const files = typeof raw.model === 'object' && raw.model !== null ? raw.model as Record<string, unknown> : {}
  const model: ReadAloudAsset[] = []
  for (const name of names) {
    const asset = testAsset(files[name], `model/${name}`)
    if (!asset || !asset.sha256) return null
    model.push(asset)
  }
  return { runtimeVersion: 'test', runtime, model, catalog: testCatalog(raw.catalog), modelFolder: 'model' }
}

function testCatalog(value: unknown): VoiceCatalogSource | null {
  if (typeof value !== 'object' || value === null) return null
  const raw = value as Record<string, unknown>
  const loopback = (url: unknown): url is string => typeof url === 'string' && /^http:\/\/127\.0\.0\.1:\d+\//.test(url)
  if (!loopback(raw.url) || !loopback(raw.base)) return null
  if (typeof raw.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(raw.sha256) || typeof raw.bytes !== 'number' || !(raw.bytes > 0)) return null
  if (typeof raw.voiceBytes !== 'number' || !(raw.voiceBytes > 0) || typeof raw.hashes !== 'object' || raw.hashes === null) return null
  const hashes: Record<string, string> = {}
  for (const [id, hash] of Object.entries(raw.hashes as Record<string, unknown>)) if (typeof hash === 'string' && /^[0-9a-f]{64}$/.test(hash) && /^[\w-]{1,40}$/.test(id)) hashes[id] = hash
  return { url: raw.url, sha256: raw.sha256, bytes: raw.bytes, base: raw.base, hashes, voiceBytes: raw.voiceBytes }
}

/** A conditioner from the checkpoint's config.json that Settings can offer (Advanced). */
export interface ModelConditioner {
  name: string
  type: 'lut' | 'continuous'
  /** lut: the values it accepts. */
  values: string[]
}

/**
 * The conditioners a checkpoint's config.json lists, minus `duration_delta` (that's the speed
 * setting). Phonon 31M has one more: `num_speakers` (lut: 0, 1, 2). Junk yields [].
 */
export function parseModelConditioners(config: unknown): ModelConditioner[] {
  if (typeof config !== 'object' || config === null) return []
  const list = (config as Record<string, unknown>).conditioners
  if (!Array.isArray(list)) return []
  const out: ModelConditioner[] = []
  for (const entry of list.slice(0, 12)) {
    if (typeof entry !== 'object' || entry === null) continue
    const raw = entry as Record<string, unknown>
    const name = typeof raw.name === 'string' ? raw.name : ''
    if (!/^[a-z][a-z0-9_]{0,40}$/.test(name) || name === 'duration_delta') continue
    if (raw.type === 'lut') {
      const lut = typeof raw.lut === 'object' && raw.lut !== null ? raw.lut as Record<string, unknown> : {}
      const values = Array.isArray(lut.possible_values) ? lut.possible_values.filter((value): value is string => typeof value === 'string' && /^[\w.-]{1,24}$/.test(value)).slice(0, 32) : []
      if (values.length > 0) out.push({ name, type: 'lut', values })
    } else if (raw.type === 'continuous') {
      out.push({ name, type: 'continuous', values: [] })
    }
  }
  return out
}
