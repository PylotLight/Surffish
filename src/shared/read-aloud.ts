/**
 * Read Aloud (experimental, Settings → Integrations → Read Aloud, off by default): Surffish reads the article (Reader
 * view's Readability extraction) or the selection out loud with Phonon, an on-device TTS model
 * (gradium/phonon-31m-en, Apache-2.0) running as WebAssembly in a hidden engine page. Nothing is
 * bundled: the first use downloads the official `phonon-tts` npm package and the model weights into
 * the profile, pinned and checked against the hashes below. Off means the read-aloud module is never
 * loaded and no menu, palette or toolbar entry shows. Falls back to the system voices (Chromium
 * speechSynthesis) if Phonon can't start, or speaks through a local OpenAI-compatible
 * `/v1/audio/speech` server when that engine is picked.
 *
 * Pure: settings, gating and player state. Shared by main, preload and renderers, so it stays small;
 * the download manifest and voices are in read-aloud-assets.ts (loaded only with the feature).
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
/** Written after the runtime, model and default voice are downloaded and verified. */
export const READ_ALOUD_READY_FILE = 'ready.json'
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
  /** A Phonon voice id from READ_ALOUD_VOICES (read-aloud-assets.ts) ('default' is the checkpoint's own voice). */
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

/** Invalid fields fall back to `fallback` (the defaults, or the current settings when saving a change). */
export function parseReadAloudSettings(value: unknown, fallback: ReadAloudSettings = DEFAULT_READ_ALOUD_SETTINGS): ReadAloudSettings {
  const raw = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
  const engine = READ_ALOUD_ENGINES.includes(raw.engine as ReadAloudEngineId) ? (raw.engine as ReadAloudEngineId) : fallback.engine
  // Any voice-id-shaped string; an id the catalog doesn't know falls back to the model voice when used.
  const voice = typeof raw.voice === 'string' && /^[\w-]{1,40}$/.test(raw.voice) ? raw.voice : fallback.voice
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

// ---------------------------------------------------------------------------
// Model download (Settings → Integrations → Read Aloud). Turning Read Aloud on starts it; the files
// stay in the profile across restarts (re-checked against their hashes once per session, never
// re-downloaded when they match) and when the feature is turned off, until Delete download.

export type ReadAloudDownloadStatus = 'absent' | 'partial' | 'checking' | 'downloading' | 'ready' | 'error' | 'cancelled'

export interface ReadAloudDownloadState {
  status: ReadAloudDownloadStatus
  /** The file being fetched ('Model weights', …) while downloading. */
  label: string
  /** Bytes fetched / to fetch in this download (only the files that were missing). */
  loaded: number
  total: number
  /** The whole model download's size (runtime + weights + tokenizer + config + default voice). */
  bytes: number
  error: string
  /** Phonon voices already in the profile (ids; 'default' comes with the model). */
  voices: string[]
  /** A voice being fetched on its own (~250 KB), picked in the tester or the player. */
  voice: { id: string; loaded: number; total: number } | null
}

export const IDLE_READ_ALOUD_DOWNLOAD: ReadAloudDownloadState = {
  status: 'absent', label: '', loaded: 0, total: 0, bytes: 0, error: '', voices: [], voice: null
}

// ---------------------------------------------------------------------------
// Voice tester (Settings → Integrations → Read Aloud): speak a sample with an engine, voice and
// speed, and show how long it took, so voices and speeds can be compared on this Mac. Its helpers
// live in read-aloud-tester.ts, which isn't parsed at launch.

export interface ReadAloudTestRequest {
  text: string
  engine: ReadAloudEngineId
  voice: string
  speed: number
}

export type ReadAloudTestStatus = 'idle' | 'preparing' | 'loading' | 'playing' | 'finished' | 'error'

export interface ReadAloudTestStats {
  /** Engine start: Phonon model load (0-ish when already loaded: `cold` false), system voice list. */
  loadMs: number | null
  cold: boolean
  /** From the engine being ready (model loaded) to the first sound. */
  firstAudioMs: number | null
  /** Audio produced and the time spent producing it (Phonon / local server). */
  audioSeconds: number | null
  generateMs: number | null
  threads: number | null
}

export interface ReadAloudTestState {
  status: ReadAloudTestStatus
  engine: ReadAloudEngineId | null
  voice: string
  speed: number
  stats: ReadAloudTestStats | null
  error: string
  fallbackReason: string
}

export const IDLE_READ_ALOUD_TEST: ReadAloudTestState = { status: 'idle', engine: null, voice: 'default', speed: 1, stats: null, error: '', fallbackReason: '' }
