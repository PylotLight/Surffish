/**
 * Cast to a Chromecast (src/main/cast-entry.ts, src/main/cast.ts): settings, the state the toolbar
 * shows, and the rules for which of a page's media a Chromecast can play by itself.
 *
 * "Cast video" hands the Chromecast's Default Media Receiver a URL, which the device then fetches
 * on its own: directly over the LAN, without the page's cookies, referer or Surffish's SOCKS proxy.
 * So only plain http(s) media files and HLS/DASH manifests qualify; MSE/blob: players (YouTube,
 * Netflix, most big sites) need "Mirror tab" instead.
 */

export const CAST_SETTINGS_FILE = 'browser-cast.json'

export interface CastSettings {
  /** Toolbar button, ⌘K commands and discovery. Discovery only runs while the picker is open or a cast is live. */
  enabled: boolean
}

export const DEFAULT_CAST_SETTINGS: CastSettings = { enabled: true }

export function parseCastSettings(value: unknown, fallback: CastSettings = DEFAULT_CAST_SETTINGS): CastSettings {
  const raw = typeof value === 'object' && value !== null ? value as Record<string, unknown> : {}
  return { enabled: typeof raw.enabled === 'boolean' ? raw.enabled : fallback.enabled }
}

export interface CastDevice {
  id: string
  name: string
  model: string
  host: string
  port: number
}

export type CastSessionStatus = 'connecting' | 'loading' | 'playing' | 'paused' | 'buffering' | 'idle' | 'ended' | 'error'

export interface CastSessionState {
  deviceId: string
  deviceName: string
  /** The tab it was started from (the tab shows a cast badge); null once that tab closed. */
  tabId: string | null
  kind: 'media' | 'mirror'
  title: string
  status: CastSessionStatus
  /** Seconds, as of `updatedAt` (ms since epoch); extrapolate while playing. */
  currentTime: number
  duration: number | null
  live: boolean
  updatedAt: number
  /** Device volume 0..1 */
  volume: number | null
  muted: boolean
  error: string | null
  /** Mirror tab: what is streaming (VP8 + Opus), refreshed every second. */
  mirror?: { width: number; height: number; kbps: number; roundTripMs: number; audio: boolean } | null
}

export interface CastSnapshot {
  enabled: boolean
  /** mDNS browsing right now (picker open or a cast live). */
  scanning: boolean
  devices: CastDevice[]
  session: CastSessionState | null
}

export interface PageMediaElement {
  kind: 'video' | 'audio'
  /** currentSrc (may be blob: for MSE players), else the first <source> */
  src: string
  currentTime: number
  /** NaN/Infinity become null (live streams report Infinity) */
  duration: number | null
  paused: boolean
  width: number
  height: number
  poster: string
  /** On screen and at least 1px */
  visible: boolean
}

export interface NetworkMediaHit {
  url: string
  /** Electron resourceType ('media', 'xhr', 'other'…) */
  resourceType: string
}

export interface PageMediaProbe {
  pageUrl: string
  title: string
  elements: PageMediaElement[]
  network: NetworkMediaHit[]
}

export type CastMediaChoice =
  | {
    castable: true
    url: string
    contentType: string
    live: boolean
    startTime: number
    posterUrl: string | null
    title: string
    /** Which <video>/<audio> to pause locally: index into the probe's elements, or -1 */
    elementIndex: number
    /** Short description for the picker ("MP4 video", "HLS stream") */
    label: string
  }
  | { castable: false; reason: 'none' | 'mse' | 'local-network' | 'unsupported'; message: string }

const MANIFEST_TYPES: Array<[RegExp, string, string]> = [
  [/\.m3u8$/i, 'application/x-mpegurl', 'HLS stream'],
  [/\.mpd$/i, 'application/dash+xml', 'DASH stream']
]
const FILE_TYPES: Array<[RegExp, string, string]> = [
  [/\.(mp4|m4v)$/i, 'video/mp4', 'MP4 video'],
  [/\.webm$/i, 'video/webm', 'WebM video'],
  [/\.mov$/i, 'video/mp4', 'QuickTime video'],
  [/\.mkv$/i, 'video/x-matroska', 'MKV video'],
  [/\.(mp3)$/i, 'audio/mpeg', 'MP3 audio'],
  [/\.(m4a|aac)$/i, 'audio/mp4', 'AAC audio'],
  [/\.(ogg|oga|opus)$/i, 'audio/ogg', 'Ogg audio'],
  [/\.(wav)$/i, 'audio/wav', 'WAV audio'],
  [/\.(flac)$/i, 'audio/flac', 'FLAC audio']
]

function pathOf(url: string): string | null {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.pathname : null
  } catch {
    return null
  }
}

/** A manifest URL (HLS/DASH) is worth remembering from a tab's network traffic. */
export function isStreamManifestUrl(url: string): boolean {
  const path = pathOf(url)
  return path !== null && MANIFEST_TYPES.some(([pattern]) => pattern.test(path))
}

/** Cheap per-request filter for the network recorder: media requests and HLS/DASH manifests. */
export function isCastableNetworkHit(url: string, resourceType: string): boolean {
  if (resourceType === 'media') return pathOf(url) !== null
  return isStreamManifestUrl(url)
}

/** Content type for the Default Media Receiver, from the URL's extension; null when unknown. */
export function castContentType(url: string, kind: 'video' | 'audio' = 'video'): { contentType: string; label: string; manifest: boolean } | null {
  const path = pathOf(url)
  if (path === null) return null
  for (const [pattern, contentType, label] of MANIFEST_TYPES) if (pattern.test(path)) return { contentType, label, manifest: true }
  for (const [pattern, contentType, label] of FILE_TYPES) if (pattern.test(path)) return { contentType, label, manifest: false }
  return kind === 'audio' ? { contentType: 'audio/mpeg', label: 'Audio', manifest: false } : { contentType: 'video/mp4', label: 'Video', manifest: false }
}

/** Hosts a Chromecast on the LAN can never reach (this Mac's loopback). */
export function isLoopbackMediaUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^\[|\]$/g, '')
    return host === 'localhost' || host.endsWith('.localhost') || /^127\./.test(host) || host === '::1'
  } catch {
    return false
  }
}

function elementScore(element: PageMediaElement): number {
  let score = element.kind === 'video' ? 1_000_000 : 0
  if (!element.paused) score += 500_000
  if (element.visible) score += 250_000
  return score + Math.min(element.width * element.height, 240_000)
}

/**
 * What "Cast video" would send: the page's main media element when its source is a plain http(s)
 * URL; for an MSE (blob:) player, an HLS/DASH manifest the tab loaded instead; otherwise the reason
 * it can't, so the picker can point at "Mirror tab".
 */
export function chooseCastMedia(probe: PageMediaProbe): CastMediaChoice {
  const ranked = probe.elements
    .map((element, index) => ({ element, index }))
    .filter(({ element }) => element.src !== '')
    .sort((a, b) => elementScore(b.element) - elementScore(a.element))
  const main = ranked[0]
  const title = probe.title.trim() || 'Surffish'
  const pick = (url: string, index: number, element: PageMediaElement | null): CastMediaChoice => {
    if (isLoopbackMediaUrl(url)) return { castable: false, reason: 'local-network', message: 'This video is served from this Mac (localhost), which the Chromecast can’t reach. Use Mirror tab.' }
    const type = castContentType(url, element?.kind ?? 'video')
    if (!type) return { castable: false, reason: 'unsupported', message: 'This media isn’t a web address a Chromecast can load. Use Mirror tab.' }
    const live = element ? element.duration === null && !element.paused : false
    return {
      castable: true,
      url,
      contentType: type.contentType,
      live,
      startTime: element ? element.currentTime : 0,
      posterUrl: element?.poster && pathOf(element.poster) !== null ? element.poster : null,
      title,
      elementIndex: index,
      label: type.label
    }
  }
  if (main && pathOf(main.element.src) !== null) return pick(main.element.src, main.index, main.element)
  // MSE player: a manifest the page fetched is the stream it is playing (newest first).
  const manifests = probe.network.filter((hit) => isStreamManifestUrl(hit.url))
  const manifest = manifests.at(-1)
  if (manifest) return pick(manifest.url, main?.index ?? -1, main?.element ?? null)
  if (main && main.element.src.startsWith('blob:')) {
    return { castable: false, reason: 'mse', message: 'This site streams video in pieces (Media Source), so a Chromecast can’t load it by itself. Use Mirror tab instead.' }
  }
  // No element (or no source): a progressive file the tab requested directly.
  const file = probe.network.filter((hit) => hit.resourceType === 'media').at(-1)
  if (file) return pick(file.url, -1, null)
  return { castable: false, reason: 'none', message: 'No video found on this page. Start playing it first, or use Mirror tab.' }
}

/** Where the cast is now (seconds), extrapolated from the last status while playing. */
export function castPosition(session: Pick<CastSessionState, 'currentTime' | 'updatedAt' | 'status' | 'duration'>, now = Date.now()): number {
  const elapsed = session.status === 'playing' ? Math.max(0, now - session.updatedAt) / 1000 : 0
  const position = session.currentTime + elapsed
  return session.duration !== null ? Math.min(position, session.duration) : position
}

export function formatCastTime(seconds: number): string {
  const total = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (value: number): string => String(value).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

/** Maps a receiver's playerState (+ idleReason) to the picker's status. */
export function castStatusFromPlayer(playerState: string, idleReason: string | null): CastSessionStatus {
  if (playerState === 'PLAYING') return 'playing'
  if (playerState === 'PAUSED') return 'paused'
  if (playerState === 'BUFFERING') return 'buffering'
  if (idleReason === 'FINISHED') return 'ended'
  if (idleReason === 'ERROR') return 'error'
  return 'idle'
}

/** Ordered for the picker: name, then id, deduplicated by id (a device answers on several interfaces). */
export function mergeCastDevices(current: readonly CastDevice[], found: readonly CastDevice[]): CastDevice[] {
  const byId = new Map<string, CastDevice>()
  for (const device of current) byId.set(device.id, device)
  for (const device of found) byId.set(device.id, device)
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
}
