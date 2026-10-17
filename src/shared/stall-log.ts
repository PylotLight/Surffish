/**
 * Debug logging: an opt-in on-disk log of main-thread stalls, crashes and a heartbeat, for chasing
 * freezes that only happen on a real Mac (src/main/stall-logger.ts). Pure parts live here so they
 * can be unit tested: settings parsing, stall detection from timer drift, process summaries, line
 * formatting and the rotation rule.
 */

export const DEBUG_LOGGING_SETTINGS_FILE = 'browser-debug-logging.json'
export const STALL_LOG_NAME = 'stalls.log'
/** The previous log once the current one passes STALL_LOG_MAX_BYTES (one generation is kept). */
export const STALL_LOG_ROTATED_NAME = 'stalls.1.log'
export const STALL_LOG_MAX_BYTES = 5 * 1024 * 1024
/** How often the main-thread probe ticks; a stall is the extra time one tick took. */
export const STALL_PROBE_INTERVAL_MS = 100
/** Report a main-thread stall at or above this (ms). */
export const STALL_THRESHOLD_MS = 500
export const STALL_HEARTBEAT_MS = 30_000

export interface DebugLoggingSettings {
  /** Main-thread stalls, crashes and a heartbeat to stalls.log. */
  enabled: boolean
}

export const DEFAULT_DEBUG_LOGGING_SETTINGS: DebugLoggingSettings = { enabled: false }

/** What Settings and the command palette show. */
export interface DebugLoggingState extends DebugLoggingSettings {
  /** SURFFISH_DEBUG_STALLS=1 at launch: on for this run whatever the setting says. */
  forcedByEnv: boolean
  /** Whether it is writing right now. */
  active: boolean
  logPath: string
}

export function parseDebugLoggingSettings(value: unknown, fallback: DebugLoggingSettings = DEFAULT_DEBUG_LOGGING_SETTINGS): DebugLoggingSettings {
  const raw = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
  return { enabled: typeof raw.enabled === 'boolean' ? raw.enabled : fallback.enabled }
}

/** SURFFISH_DEBUG_STALLS=1 (or true/yes/on). */
export function debugStallsFromEnv(value: string | undefined): boolean {
  return /^(1|true|yes|on)$/i.test(value?.trim() ?? '')
}

/**
 * One probe tick: `elapsed` ms since the previous tick of a timer set for `interval` ms. Returns the
 * stall length (the whole time the thread was away) when it is at least `threshold`, else null.
 */
export function stallFromTick(elapsed: number, interval = STALL_PROBE_INTERVAL_MS, threshold = STALL_THRESHOLD_MS): number | null {
  if (!Number.isFinite(elapsed)) return null
  return elapsed - interval >= threshold ? Math.round(elapsed) : null
}

/** The fields of Electron's ProcessMetric the log uses (CPU %, working set in KB). */
export interface ProcessMetricLike {
  type: string
  cpu?: { percentCPUUsage?: number }
  memory?: { workingSetSize?: number }
  name?: string
  serviceName?: string
}

export interface ProcessGroupSummary {
  type: string
  count: number
  cpu: number
  rssMB: number
}

/** Per process type: count, summed CPU % and summed working set (MB), busiest first. */
export function summarizeProcesses(metrics: readonly ProcessMetricLike[]): ProcessGroupSummary[] {
  const groups = new Map<string, ProcessGroupSummary>()
  for (const metric of metrics) {
    const type = metric.type === 'Utility' && (metric.serviceName || metric.name) ? `Utility(${metric.serviceName || metric.name})` : metric.type
    const group = groups.get(type) ?? { type, count: 0, cpu: 0, rssMB: 0 }
    group.count += 1
    group.cpu += metric.cpu?.percentCPUUsage ?? 0
    group.rssMB += (metric.memory?.workingSetSize ?? 0) / 1024
    groups.set(type, group)
  }
  return [...groups.values()]
    .map((group) => ({ ...group, cpu: Math.round(group.cpu * 10) / 10, rssMB: Math.round(group.rssMB) }))
    .sort((a, b) => b.cpu - a.cpu || b.rssMB - a.rssMB)
}

export interface SnapshotWriteStats {
  files: number
  bytes: number
  flushes: number
  flushMs: number
}

/** Change in the running totals since the previous reading. */
export function snapshotWritesSince(current: SnapshotWriteStats, previous: SnapshotWriteStats): SnapshotWriteStats {
  return {
    files: Math.max(0, current.files - previous.files),
    bytes: Math.max(0, current.bytes - previous.bytes),
    flushes: Math.max(0, current.flushes - previous.flushes),
    flushMs: Math.max(0, Math.round(current.flushMs - previous.flushMs))
  }
}

export interface StallSnapshot {
  processes: ProcessGroupSummary[]
  freeMB: number
  totalMB: number
  /** macOS kern.memorystatus_vm_pressure_level (1 normal, 2 warn, 4 critical); null elsewhere / unknown. */
  macPressure: number | null
  load: readonly number[]
  windows: number | null
  tabs: number | null
  /** Tabs with a live renderer (not hibernated). */
  awakeTabs: number | null
  /** Hidden omnibox prerender views alive (0 or 1). */
  prerenders: number | null
  /** Since the previous line: wake snapshot pictures written to disk, their bytes, flushes and main-thread ms spent in them. */
  snapshotWrites: SnapshotWriteStats | null
}

const MB = (value: number): string => (value >= 1024 ? `${(value / 1024).toFixed(1)}GB` : `${Math.round(value)}MB`)

export function formatSnapshot(snapshot: StallSnapshot): string {
  const count = snapshot.processes.reduce((sum, group) => sum + group.count, 0)
  const cpu = Math.round(snapshot.processes.reduce((sum, group) => sum + group.cpu, 0) * 10) / 10
  const rss = snapshot.processes.reduce((sum, group) => sum + group.rssMB, 0)
  const groups = snapshot.processes.map((group) => `${group.type}×${group.count} ${group.cpu}% ${MB(group.rssMB)}`).join(', ')
  const parts = [
    `procs=${count} cpu=${cpu}% rss=${MB(rss)} [${groups}]`,
    `free=${MB(snapshot.freeMB)}/${MB(snapshot.totalMB)}`,
    ...(snapshot.macPressure === null ? [] : [`pressure=${snapshot.macPressure}`]),
    `load=${snapshot.load.map((value) => value.toFixed(2)).join(',')}`
  ]
  if (snapshot.windows !== null) parts.push(`windows=${snapshot.windows}`)
  if (snapshot.tabs !== null) parts.push(`tabs=${snapshot.tabs}${snapshot.awakeTabs === null ? '' : ` awake=${snapshot.awakeTabs}`}`)
  if (snapshot.prerenders !== null) parts.push(`prerender=${snapshot.prerenders}`)
  const writes = snapshot.snapshotWrites
  if (writes) parts.push(`snapshotWrites=${writes.files} (${Math.round(writes.bytes / 1024)}KB in ${writes.flushes} flush${writes.flushes === 1 ? '' : 'es'}, ${writes.flushMs}ms on main)`)
  return parts.join(' | ')
}

const pad = (value: number, width = 2): string => String(value).padStart(width, '0')

/** Local wall clock with its UTC offset: 2026-10-17 14:53:07.123 +11:00. */
export function stallLogStamp(date: Date): string {
  const offset = -date.getTimezoneOffset()
  const sign = offset >= 0 ? '+' : '-'
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)} ${sign}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`
}

/** One log line: stamp, kind (upper case), detail. Newlines in the detail are flattened. */
export function formatStallLine(date: Date, kind: string, detail: string): string {
  return `${stallLogStamp(date)} ${kind.toUpperCase()} ${detail.replace(/\s*[\r\n]+\s*/g, ' ').slice(0, 2000)}\n`
}

/** Rotate before appending `incoming` bytes to a log of `size` bytes? (Never for an empty log.) */
export function shouldRotateStallLog(size: number, incoming: number, max = STALL_LOG_MAX_BYTES): boolean {
  return size > 0 && size + incoming > max
}

/**
 * What a page is called in the log: the host of an http(s) page only (never the path, query or
 * content), the app's own surfaces by name, and nothing at all for private pages.
 */
export function stallLogPageLabel(url: string, isPrivate: boolean): string {
  if (isPrivate) return 'private'
  const surface = /[?&]surface=([a-z-]+)/.exec(url)?.[1]
  if (surface) return `shell:${surface}`
  try {
    const parsed = new URL(url)
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return parsed.host
    if (parsed.protocol === 'chrome-extension:') return `extension:${parsed.host}`
    return parsed.protocol.replace(/:$/, '') || 'page'
  } catch {
    return 'page'
  }
}
