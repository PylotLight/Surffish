/**
 * Read Aloud helpers for the model download row and the voice tester (Settings → Integrations →
 * Read Aloud) and the lazy read-aloud module. Kept out of read-aloud.ts so nothing here is parsed
 * at launch (main's startup bundle imports read-aloud.ts for the gate).
 */
import { DEFAULT_READ_ALOUD_SETTINGS, nearestSpeed, READ_ALOUD_ENGINES, type ReadAloudDownloadState, type ReadAloudEngineId, type ReadAloudSettings, type ReadAloudTestRequest, type ReadAloudTestStats } from './read-aloud'

/** Whole percent, 0–100 (0 while the total is unknown). */
export function downloadPercent(loaded: number, total: number): number {
  if (!(total > 0) || !(loaded > 0)) return 0
  return Math.max(0, Math.min(100, Math.floor((loaded / total) * 100)))
}

export function isReadAloudDownloadBusy(state: Pick<ReadAloudDownloadState, 'status'>): boolean {
  return state.status === 'checking' || state.status === 'downloading'
}

export const READ_ALOUD_SAMPLE_TEXT = 'Surffish can read articles out loud, right here on this Mac. This is how the voice sounds at this speed.'
export const READ_ALOUD_TEST_MAX_CHARS = 600

/** A tester request from a renderer, or null. Empty text speaks the default sample. */
export function parseReadAloudTestRequest(value: unknown, fallback: ReadAloudSettings = DEFAULT_READ_ALOUD_SETTINGS): ReadAloudTestRequest | null {
  if (typeof value !== 'object' || value === null) return null
  const raw = value as Record<string, unknown>
  const text = (typeof raw.text === 'string' ? raw.text : '').replace(/\s+/g, ' ').trim().slice(0, READ_ALOUD_TEST_MAX_CHARS) || READ_ALOUD_SAMPLE_TEXT
  const engine = READ_ALOUD_ENGINES.includes(raw.engine as ReadAloudEngineId) ? (raw.engine as ReadAloudEngineId) : fallback.engine
  const voice = typeof raw.voice === 'string' && /^[\w-]{1,40}$/.test(raw.voice) ? raw.voice : fallback.voice
  return { text, engine, voice, speed: raw.speed === undefined ? fallback.speed : nearestSpeed(raw.speed, fallback.speed) }
}

/** Seconds of compute per second of audio (below 1 is faster than real time), or null. */
export function realtimeFactor(stats: Pick<ReadAloudTestStats, 'generateMs' | 'audioSeconds'> | null): number | null {
  if (!stats || stats.generateMs === null || stats.audioSeconds === null || !(stats.audioSeconds > 0) || !(stats.generateMs >= 0)) return null
  return Math.round((stats.generateMs / 1000 / stats.audioSeconds) * 100) / 100
}

/** Merge a partial stats report from the engine into what the tester already has. */
export function mergeTestStats(previous: ReadAloudTestStats | null, value: unknown): ReadAloudTestStats | null {
  if (typeof value !== 'object' || value === null) return previous
  const raw = value as Record<string, unknown>
  const number = (key: string, fallback: number | null): number | null => typeof raw[key] === 'number' && Number.isFinite(raw[key]) && (raw[key] as number) >= 0 ? Math.round((raw[key] as number) * 1000) / 1000 : fallback
  const base: ReadAloudTestStats = previous ?? { loadMs: null, cold: false, firstAudioMs: null, audioSeconds: null, generateMs: null, threads: null }
  return {
    loadMs: number('loadMs', base.loadMs),
    cold: typeof raw.cold === 'boolean' ? raw.cold : base.cold,
    firstAudioMs: number('firstAudioMs', base.firstAudioMs),
    audioSeconds: number('audioSeconds', base.audioSeconds),
    generateMs: number('generateMs', base.generateMs),
    threads: number('threads', base.threads)
  }
}
