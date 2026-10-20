/**
 * Read Aloud downloads: the pinned Phonon runtime (official `phonon-tts` npm package), the Phonon 31M
 * English model and its voices, each checked against the hash below before use. Only the read-aloud
 * module and the Settings chunk import this, so none of it is parsed at launch.
 */
import { nearestSpeed } from './read-aloud'

export interface ReadAloudVoice {
  id: string
  name: string
  locale: 'en-us' | 'en-gb' | 'model'
  /** Engine-page path under READ_ALOUD_MODEL_PATH. */
  file: string
  bytes: number
  sha256: string
  url: string
}

const MODEL_REPO = 'https://huggingface.co/gradium/phonon-31m-en/resolve/8c64b55ec301728e2d1695bfea87a08a267d0c2d'
const VOICES_REPO = 'https://huggingface.co/gradium/phonon-voices/resolve/0ee17205f254b5abc43b266c8a0f215565c352f7'

function catalogVoice(id: string, name: string, locale: 'en-us' | 'en-gb', sha256: string): ReadAloudVoice {
  return { id, name, locale, file: `voices/${id}.safetensors`, bytes: 256136, sha256, url: `${VOICES_REPO}/voices/${id}.safetensors` }
}

/**
 * Phonon 31M voices (gradium/phonon-voices, Apache-2.0, ~250 KB each, fetched the first time one is
 * picked). 'default' ships with the model download.
 */
export const READ_ALOUD_VOICES: readonly ReadAloudVoice[] = [
  { id: 'default', name: 'Default', locale: 'model', file: 'default-voice.safetensors', bytes: 256136, sha256: 'f739e8c4c76ee7f92e7c94a82002748c8cd22e99582ac49f7b9b94cd63786e18', url: `${MODEL_REPO}/default-voice.safetensors` },
  catalogVoice('NbpkqMVS3CJeq2j8', 'Zoey', 'en-us', '97c7f8c253413574406ab80dd23f49c3ebb2517163b00a9bf86b9c4cf43e7e23'),
  catalogVoice('vjFyp2BcCyTlUmYb', 'Everly', 'en-us', '958ea94da14f46dd48c7f64adac11ed2ad2aa45f7ccd165dfebab5272664402e'),
  catalogVoice('4SZHfMpw-p46Ywgs', 'Harper', 'en-us', '6b3da6e2d796a20c51af892c482bd6509fb88267a221aff83c870843dee2a123'),
  catalogVoice('LMDIYE0Oa377Qh6Z', 'Easton', 'en-us', '45c582673cb20edb04ddcca2b5a8865ddfb0a82599efadb269021e87d20fbdd4'),
  catalogVoice('40QrMVgAxFiUnP9f', 'Micah', 'en-us', '0de1098d1051686a138d068e83ff09deb5053328bc74ec9541a1fdb90bfc24da'),
  catalogVoice('d9XCyhjo4JhkHF1d', 'Miles', 'en-us', 'eab20e4f159b48cfbc01b1885804e24f681f80e7a64f909182763a4e3361bee8'),
  catalogVoice('6PWnV0Nq4wu7RVBT', 'Maeve', 'en-gb', '56494ee67d533ad227ff0dfd0b1c13ff5aa91f1ad6e596e66c2986ba3005e844'),
  catalogVoice('GgfEkEJtxZR7gnpy', 'Freya', 'en-gb', 'eb3cd47418349e618408c16bea7153988b3ad04b41a6033039dd474a9a4dcd23'),
  catalogVoice('X6NceqF285Gr04gb', 'Alfie', 'en-gb', '4de75497fff3030168e8aa6dca23ffeb332b1bc8c25d0bf3507ceadac953ae9c'),
  catalogVoice('YyKcxPG7iIgS3jsK', 'Hugh', 'en-gb', '3169d74b47a54d1eb15e4c243f56393abe9fe90c7e1c308ecf96ee67618b152a')
]

export function readAloudVoice(id: string): ReadAloudVoice {
  return READ_ALOUD_VOICES.find((voice) => voice.id === id) ?? READ_ALOUD_VOICES[0]!
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
  { label: 'Default voice', url: READ_ALOUD_VOICES[0]!.url, file: `model/${READ_ALOUD_VOICES[0]!.file}`, bytes: 256136, sha256: READ_ALOUD_VOICES[0]!.sha256 }
]

export function voiceAsset(voice: ReadAloudVoice): ReadAloudAsset {
  return { label: `Voice: ${voice.name}`, url: voice.url, file: `model/${voice.file}`, bytes: voice.bytes, sha256: voice.sha256 }
}

/** Bytes the first Read Aloud downloads (runtime + model + default voice). */
export function firstUseDownloadBytes(): number {
  return PHONON_RUNTIME.bytes + PHONON_MODEL_ASSETS.reduce((sum, asset) => sum + asset.bytes, 0)
}

export function formatDownloadSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1)} MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`
  return `${bytes} B`
}

/**
 * Speech rate → Phonon's `duration_delta` conditioner (negative speaks faster). The model card
 * gives no scale; these were picked by ear on short samples and want a Mac listen.
 */
export function speedToDurationDelta(speed: number): number {
  const delta = (1 - nearestSpeed(speed)) * 0.6
  return Math.round(Math.min(0.3, Math.max(-0.4, delta)) * 1000) / 1000
}
