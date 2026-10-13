/**
 * Diagnostics / Task Manager: turn app.getAppMetrics() plus "who lives in which process" into
 * labelled rows. Pure, so it is unit tested without Electron.
 */

/** How often the panel samples while it is open. Nothing samples while it is closed. */
export const DIAGNOSTICS_SAMPLE_INTERVAL_MS = 2_000

export type DiagnosticsProcessKind =
  | 'browser'
  | 'gpu'
  | 'utility'
  | 'tab'
  | 'subframe'
  | 'shell'
  | 'overlay'
  | 'extension'
  | 'pdf-editor'
  | 'renderer'
  | 'other'

/** One thing living in a process: a tab, a shell surface, an overlay, an extension page, a cross-site frame… */
export interface DiagnosticsOccupant {
  pid: number
  kind: Exclude<DiagnosticsProcessKind, 'browser' | 'gpu' | 'utility' | 'renderer' | 'other'>
  label: string
  /** Browser tab id when the occupant is (or belongs to) a tab. */
  tabId?: string
  /** Origin / URL detail shown under the label. */
  detail?: string
}

/** The subset of Electron's ProcessMetric this module reads. */
export interface DiagnosticsMetricInput {
  pid: number
  type: string
  name?: string
  serviceName?: string
  creationTime?: number
  cpu: { percentCPUUsage: number; idleWakeupsPerSecond: number }
  /** Electron reports kilobytes. */
  memory: { workingSetSize: number; privateBytes?: number }
}

export interface DiagnosticsRow {
  pid: number
  /** Electron process type: Browser, Tab, GPU, Utility… */
  type: string
  kind: DiagnosticsProcessKind
  label: string
  /** Everything else sharing the process (site isolation can put several tabs in one renderer). */
  members: { kind: DiagnosticsOccupant['kind']; label: string; detail?: string; tabId?: string }[]
  cpu: number
  idleWakeups: number
  memoryKB: number
  privateKB: number | null
  /** Tabs whose main frame runs here; the row offers Reload / Discard for the first. */
  tabIds: string[]
  /** Whether the row may be killed (never the browser process or the app's own UI). */
  canKill: boolean
}

export interface DiagnosticsTabUsage {
  pid: number
  cpu: number
  memoryKB: number
  /** Other tabs sharing that renderer. */
  sharedWith: number
}

export interface DiagnosticsSnapshot {
  sampledAt: number
  intervalMs: number
  totals: { cpu: number; memoryKB: number; idleWakeups: number; processes: number; renderers: number }
  rows: DiagnosticsRow[]
  tabs: Record<string, DiagnosticsTabUsage>
}

/** What main sends: the snapshot plus running service workers no page could be matched to. */
export type DiagnosticsPayload = DiagnosticsSnapshot & { unattributedWorkers: string[] }

export type DiagnosticsSortKey = 'cpu' | 'memory' | 'wakeups' | 'pid' | 'name'
export type DiagnosticsSortDirection = 'asc' | 'desc'

/** Rank occupants so the row label names the most meaningful one. */
const KIND_RANK: Record<DiagnosticsOccupant['kind'], number> = {
  tab: 0,
  'pdf-editor': 1,
  extension: 2,
  shell: 3,
  overlay: 4,
  subframe: 5
}

const NO_KILL_KINDS: ReadonlySet<DiagnosticsProcessKind> = new Set(['browser', 'shell'])

function round1(value: number): number {
  return Number.isFinite(value) ? Math.round(value * 10) / 10 : 0
}

function utilityLabel(metric: DiagnosticsMetricInput): string {
  const name = (metric.name || metric.serviceName || '').trim()
  if (!name) return 'Utility'
  // serviceName looks like "network.mojom.NetworkService"; name is the readable "Network Service".
  if (metric.name) return `Utility: ${metric.name}`
  const last = name.split('.').pop() ?? name
  return `Utility: ${last.replace(/([a-z])([A-Z])/g, '$1 $2')}`
}

function labelForOccupants(occupants: DiagnosticsOccupant[]): { kind: DiagnosticsProcessKind; label: string } {
  const sorted = [...occupants].sort((a, b) => KIND_RANK[a.kind] - KIND_RANK[b.kind])
  const first = sorted[0]!
  const sameKind = sorted.filter((occupant) => occupant.kind === first.kind)
  if (first.kind === 'tab' && sameKind.length > 1) {
    return { kind: 'tab', label: `${sameKind.length} tabs: ${sameKind.map((occupant) => occupant.label).join(', ')}` }
  }
  const prefix = first.kind === 'tab' ? 'Tab'
    : first.kind === 'pdf-editor' ? 'PDF editor'
      : first.kind === 'extension' ? 'Extension'
        : first.kind === 'shell' ? 'Surffish UI'
          : first.kind === 'overlay' ? 'Overlay'
            : 'Subframe'
  return { kind: first.kind, label: `${prefix}: ${first.label}` }
}

/** Label every process and total the numbers. Occupants without a matching process are ignored. */
export function buildDiagnosticsSnapshot(
  metrics: readonly DiagnosticsMetricInput[],
  occupants: readonly DiagnosticsOccupant[],
  sampledAt: number,
  intervalMs = DIAGNOSTICS_SAMPLE_INTERVAL_MS
): DiagnosticsSnapshot {
  const byPid = new Map<number, DiagnosticsOccupant[]>()
  for (const occupant of occupants) {
    if (!Number.isInteger(occupant.pid) || occupant.pid <= 0) continue
    const list = byPid.get(occupant.pid) ?? []
    // The same tab can show up twice (main frame + a same-process subframe); keep one entry.
    if (!list.some((entry) => entry.kind === occupant.kind && entry.label === occupant.label && entry.tabId === occupant.tabId)) list.push(occupant)
    byPid.set(occupant.pid, list)
  }

  const rows: DiagnosticsRow[] = metrics.map((metric) => {
    const here = byPid.get(metric.pid) ?? []
    let kind: DiagnosticsProcessKind
    let label: string
    if (metric.type === 'Browser') {
      kind = 'browser'
      label = 'Browser (main process)'
    } else if (metric.type === 'GPU') {
      kind = 'gpu'
      label = 'GPU process'
    } else if (metric.type === 'Utility') {
      kind = 'utility'
      label = utilityLabel(metric)
    } else if (here.length > 0) {
      ({ kind, label } = labelForOccupants(here))
    } else if (metric.type === 'Tab') {
      kind = 'renderer'
      label = 'Renderer (no page: service worker or spare)'
    } else {
      kind = 'other'
      label = metric.name || metric.serviceName || metric.type || 'Process'
    }
    const tabIds = here.filter((occupant) => occupant.kind === 'tab' || occupant.kind === 'pdf-editor').map((occupant) => occupant.tabId).filter((id): id is string => Boolean(id))
    return {
      pid: metric.pid,
      type: metric.type,
      kind,
      label,
      members: [...here].sort((a, b) => KIND_RANK[a.kind] - KIND_RANK[b.kind]).map(({ kind: memberKind, label: memberLabel, detail, tabId }) => ({ kind: memberKind, label: memberLabel, ...(detail ? { detail } : {}), ...(tabId ? { tabId } : {}) })),
      cpu: round1(metric.cpu.percentCPUUsage),
      idleWakeups: Math.max(0, Math.round(metric.cpu.idleWakeupsPerSecond || 0)),
      memoryKB: Math.max(0, Math.round(metric.memory.workingSetSize || 0)),
      privateKB: typeof metric.memory.privateBytes === 'number' ? Math.round(metric.memory.privateBytes) : null,
      tabIds: [...new Set(tabIds)],
      // The app's own UI shares nothing with sites; killing it would blank the window.
      canKill: !NO_KILL_KINDS.has(kind) && !here.some((occupant) => occupant.kind === 'shell')
    }
  })

  const tabs: Record<string, DiagnosticsTabUsage> = {}
  for (const row of rows) {
    for (const tabId of row.tabIds) {
      tabs[tabId] = { pid: row.pid, cpu: row.cpu, memoryKB: row.memoryKB, sharedWith: row.tabIds.length - 1 }
    }
  }

  return {
    sampledAt,
    intervalMs,
    totals: {
      cpu: round1(rows.reduce((sum, row) => sum + row.cpu, 0)),
      memoryKB: rows.reduce((sum, row) => sum + row.memoryKB, 0),
      idleWakeups: rows.reduce((sum, row) => sum + row.idleWakeups, 0),
      processes: rows.length,
      renderers: rows.filter((row) => row.type === 'Tab').length
    },
    rows,
    tabs
  }
}

export function sortDiagnosticsRows(rows: readonly DiagnosticsRow[], key: DiagnosticsSortKey, direction: DiagnosticsSortDirection): DiagnosticsRow[] {
  const sign = direction === 'asc' ? 1 : -1
  const value = (row: DiagnosticsRow): number | string => key === 'cpu' ? row.cpu
    : key === 'memory' ? row.memoryKB
      : key === 'wakeups' ? row.idleWakeups
        : key === 'pid' ? row.pid
          : row.label.toLowerCase()
  return [...rows].sort((a, b) => {
    const left = value(a)
    const right = value(b)
    const order = typeof left === 'string' || typeof right === 'string'
      ? String(left).localeCompare(String(right))
      : left - right
    return order !== 0 ? order * sign : a.pid - b.pid
  })
}

/** "512 KB", "84.3 MB", "1.27 GB" from kilobytes. */
export function formatDiagnosticsMemory(kilobytes: number): string {
  if (!Number.isFinite(kilobytes) || kilobytes <= 0) return '0 KB'
  if (kilobytes < 1024) return `${Math.round(kilobytes)} KB`
  const megabytes = kilobytes / 1024
  if (megabytes < 1024) return `${megabytes.toFixed(megabytes < 100 ? 1 : 0)} MB`
  return `${(megabytes / 1024).toFixed(2)} GB`
}

/** Short hint for the tab hover tooltip, e.g. "84 MB · 3.2% CPU (shared with 1 tab)". */
export function formatTabUsageHint(usage: DiagnosticsTabUsage | undefined): string {
  if (!usage) return ''
  const memory = formatDiagnosticsMemory(usage.memoryKB).replace(/\.\d MB$/, ' MB')
  const shared = usage.sharedWith > 0 ? ` (shared with ${usage.sharedWith} tab${usage.sharedWith === 1 ? '' : 's'})` : ''
  return `${memory} · ${usage.cpu.toFixed(1)}% CPU${shared}`
}

/** "Example Domain — example.com" for a tab occupant; the origin keeps same-titled tabs apart. */
export function describeTabOccupant(title: string, url: string): { label: string; detail: string } {
  let origin = ''
  try {
    const parsed = new URL(url)
    origin = parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.host : parsed.protocol.replace(/:$/, '')
  } catch {
    origin = ''
  }
  const cleanTitle = title.trim() || origin || 'Untitled'
  return { label: cleanTitle, detail: origin && origin !== cleanTitle ? origin : url }
}
