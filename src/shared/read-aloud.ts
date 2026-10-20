/**
 * Read Aloud (experimental, Settings → Features, off by default): Surffish reads the article (Reader
 * view's Readability extraction) or the selection out loud with Phonon, an on-device TTS model
 * (gradium/phonon-31m-en, Apache-2.0) running as WebAssembly in a hidden engine page. Nothing is
 * bundled: the first use downloads the official `phonon-tts` npm package and the model weights into
 * the profile, pinned and checked against the hashes below. Off means the read-aloud module is never
 * loaded and no menu, palette or toolbar entry shows. Falls back to the system voices (Chromium
 * speechSynthesis) if Phonon can't start, or speaks through a local OpenAI-compatible
 * `/v1/audio/speech` server when that engine is picked.
 *
 * Pure: settings, the download manifest, voices and speed. Shared by main, preload and renderers.
 */

export const READ_ALOUD_SETTINGS_FILE = 'browser-read-aloud.json'
/** The hidden engine page's origin. Its own in-memory session; no network but its own files. */
export const READ_ALOUD_SCHEME = 'surffish-tts'
export const READ_ALOUD_HOST = 'engine'
export const READ_ALOUD_ORIGIN = `${READ_ALOUD_SCHEME}://${READ_ALOUD_HOST}`
export const READ_ALOUD_PAGE = 'read-aloud.html'
export const READ_ALOUD_URL = `${READ_ALOUD_ORIGIN}/${READ_ALOUD_PAGE}`
export const READ_ALOUD_PARTITION = 'surffish-read-aloud'
/** Folder under userData holding the downloaded runtime and model. Deleting it re-downloads. */
export const READ_ALOUD_DIRECTORY = 'read-aloud'
/** Engine-page paths for the downloaded files (served from the profile folder by main). */
export const READ_ALOUD_RUNTIME_PATH = '/runtime/'
export const READ_ALOUD_MODEL_PATH = '/model/'
export const READ_ALOUD_DISABLED_ERROR = 'read aloud disabled'

export const READ_ALOUD_ENGINES = ['phonon', 'system', 'openai'] as const
export type ReadAloudEngineId = (typeof READ_ALOUD_ENGINES)[number]

/** Speech rates offered in the player. Phonon gets them as its `duration_delta` conditioner. */
export const READ_ALOUD_SPEEDS = [0.8, 1, 1.15, 1.3, 1.5] as const

export interface ReadAloudSettings {
  enabled: boolean
  engine: ReadAloudEngineId
  /** A Phonon voice id from READ_ALOUD_VOICES ('default' is the checkpoint's own voice). */
  voice: string
  speed: number
  /** openai engine only: loopback base URL, e.g. http://127.0.0.1:8880/v1 (ptts-openai-server). */
  endpoint: string
  /** openai engine only: the server's voice name ('' lets it pick). */
  endpointVoice: string
}

export const DEFAULT_READ_ALOUD_SETTINGS: ReadAloudSettings = {
  enabled: false,
  engine: 'phonon',
  voice: 'default',
  speed: 1,
  endpoint: 'http://127.0.0.1:8880/v1',
  endpointVoice: ''
}

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

/** Loopback http(s) only: the text being read never leaves the machine through this setting. */
export function isLoopbackSpeechEndpoint(value: string): boolean {
  try {
    const url = new URL(value)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
    if (url.username || url.password) return false
    return url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '[::1]'
  } catch {
    return false
  }
}

/** `<endpoint>/audio/speech`, accepting a base with or without the trailing `/v1`. */
export function speechEndpointUrl(endpoint: string): string | null {
  if (!isLoopbackSpeechEndpoint(endpoint)) return null
  const base = endpoint.trim().replace(/\/+$/, '')
  return /\/v1$/.test(base) ? `${base}/audio/speech` : `${base}/v1/audio/speech`
}

export function nearestSpeed(value: unknown, fallback = 1): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  let best: number = READ_ALOUD_SPEEDS[0]
  for (const speed of READ_ALOUD_SPEEDS) if (Math.abs(speed - value) < Math.abs(best - value)) best = speed
  return best
}

/**
 * Speech rate → Phonon's `duration_delta` conditioner (negative speaks faster). The model card
 * gives no scale; these were picked by ear on short samples and want a Mac listen.
 */
export function speedToDurationDelta(speed: number): number {
  const delta = (1 - nearestSpeed(speed)) * 0.6
  return Math.round(Math.min(0.3, Math.max(-0.4, delta)) * 1000) / 1000
}

/** Invalid fields fall back to `fallback` (the defaults, or the current settings when saving a change). */
export function parseReadAloudSettings(value: unknown, fallback: ReadAloudSettings = DEFAULT_READ_ALOUD_SETTINGS): ReadAloudSettings {
  const raw = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
  const engine = READ_ALOUD_ENGINES.includes(raw.engine as ReadAloudEngineId) ? (raw.engine as ReadAloudEngineId) : fallback.engine
  const voice = typeof raw.voice === 'string' && READ_ALOUD_VOICES.some((candidate) => candidate.id === raw.voice) ? raw.voice : fallback.voice
  const endpoint = typeof raw.endpoint === 'string' && isLoopbackSpeechEndpoint(raw.endpoint.trim()) ? raw.endpoint.trim().replace(/\/+$/, '') : fallback.endpoint
  const endpointVoice = typeof raw.endpointVoice === 'string' ? raw.endpointVoice.trim().slice(0, 80) : fallback.endpointVoice
  return {
    enabled: typeof raw.enabled === 'boolean' ? raw.enabled : fallback.enabled,
    engine,
    voice,
    speed: raw.speed === undefined ? fallback.speed : nearestSpeed(raw.speed, fallback.speed),
    endpoint,
    endpointVoice
  }
}

/** Command palette entries that only exist while Read Aloud is on. */
export const READ_ALOUD_COMMAND_IDS: readonly string[] = ['readAloud.page', 'readAloud.selection', 'readAloud.pause', 'readAloud.stop']

export function isCommandHiddenByReadAloud(id: string, enabled: boolean): boolean {
  return !enabled && READ_ALOUD_COMMAND_IDS.includes(id)
}

/** Page context menu entries: feature on, a web page (http/https) or the built-in Reader view. */
export function canOfferReadAloud(options: { enabled: boolean; url: string; pdf: boolean }): boolean {
  return options.enabled && !options.pdf && /^https?:\/\//i.test(options.url)
}

export type ReadAloudStatus = 'idle' | 'downloading' | 'loading' | 'playing' | 'paused' | 'error'

/** What the toolbar control and the Reader view show. One reading at a time, app-wide. */
export interface ReadAloudState {
  status: ReadAloudStatus
  /** The tab being read (null when idle). */
  tabId: string | null
  title: string
  /** Sentence being spoken, 0-based, and how many there are. */
  index: number
  total: number
  /** Engine actually speaking: 'phonon', or 'system' after a fallback. */
  engine: ReadAloudEngineId | null
  /** Why Phonon was not used, when it fell back. */
  fallbackReason: string
  speed: number
  voice: string
  /** First-use download progress. */
  download: { label: string; loaded: number; total: number } | null
  error: string
}

export const IDLE_READ_ALOUD_STATE: ReadAloudState = {
  status: 'idle', tabId: null, title: '', index: 0, total: 0, engine: null, fallbackReason: '', speed: 1, voice: 'default', download: null, error: ''
}

export type ReadAloudControl = 'toggle' | 'pause' | 'resume' | 'stop' | 'next' | 'previous'

export function isReadAloudControl(value: unknown): value is ReadAloudControl {
  return value === 'toggle' || value === 'pause' || value === 'resume' || value === 'stop' || value === 'next' || value === 'previous'
}

/** A reading in progress (anything but idle/error) keeps the toolbar control on screen. */
export function isReadAloudActive(state: Pick<ReadAloudState, 'status'>): boolean {
  return state.status === 'downloading' || state.status === 'loading' || state.status === 'playing' || state.status === 'paused'
}
