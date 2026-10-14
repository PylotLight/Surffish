import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildDiagnosticsSnapshot,
  describeTabOccupant,
  formatDiagnosticsMemory,
  formatTabUsageHint,
  sortDiagnosticsRows,
  type DiagnosticsMetricInput,
  type DiagnosticsOccupant
} from './diagnostics.ts'

function metric(pid: number, type: string, cpu: number, memoryKB: number, wakeups = 0, extra: Partial<DiagnosticsMetricInput> = {}): DiagnosticsMetricInput {
  return { pid, type, cpu: { percentCPUUsage: cpu, idleWakeupsPerSecond: wakeups }, memory: { workingSetSize: memoryKB }, ...extra }
}

const metrics: DiagnosticsMetricInput[] = [
  metric(1, 'Browser', 1.04, 400_000, 8),
  metric(2, 'GPU', 55.7, 90_000, 246),
  metric(3, 'Utility', 0.1, 70_000, 0, { name: 'Network Service', serviceName: 'network.mojom.NetworkService' }),
  metric(4, 'Utility', 0, 20_000, 0, { serviceName: 'storage.mojom.StorageService' }),
  metric(10, 'Tab', 0.3, 110_000, 4),
  metric(11, 'Tab', 18.5, 95_000, 114),
  metric(20, 'Tab', 2.25, 150_000, 60),
  metric(21, 'Tab', 0.6, 60_000, 176),
  metric(22, 'Tab', 0, 30_000, 0),
  metric(23, 'Tab', 0, 25_000, 0)
]
const occupants: DiagnosticsOccupant[] = [
  { pid: 10, kind: 'shell', label: 'toolbar' },
  { pid: 11, kind: 'shell', label: 'sidebar' },
  { pid: 20, kind: 'tab', label: 'Docs', tabId: 'a', detail: 'docs.example.com' },
  { pid: 20, kind: 'tab', label: 'Docs 2', tabId: 'b', detail: 'docs.example.com' },
  { pid: 20, kind: 'tab', label: 'Docs', tabId: 'a', detail: 'docs.example.com' },
  { pid: 21, kind: 'subframe', label: 'ads.example.net', detail: 'in Docs' },
  { pid: 22, kind: 'extension', label: 'Modern for HN' },
  { pid: 999, kind: 'tab', label: 'Gone', tabId: 'z' }
]

test('every process gets a label, kind and kill policy', () => {
  const snapshot = buildDiagnosticsSnapshot(metrics, occupants, 1000)
  const row = (pid: number) => snapshot.rows.find((entry) => entry.pid === pid)!
  assert.equal(row(1).label, 'Browser (main process)')
  assert.equal(row(1).canKill, false)
  assert.equal(row(2).kind, 'gpu')
  assert.equal(row(2).canKill, true)
  assert.equal(row(3).label, 'Utility: Network Service')
  assert.equal(row(4).label, 'Utility: Storage Service')
  assert.equal(row(10).label, 'Surffish UI: toolbar')
  assert.equal(row(10).canKill, false, 'the app UI is never killable')
  assert.equal(row(21).label, 'Subframe: ads.example.net')
  assert.equal(row(22).label, 'Extension: Modern for HN')
  assert.equal(row(23).kind, 'renderer')
  assert.match(row(23).label, /service worker or spare/)
})

test('tabs sharing a renderer are grouped and deduplicated', () => {
  const snapshot = buildDiagnosticsSnapshot(metrics, occupants, 1000)
  const shared = snapshot.rows.find((entry) => entry.pid === 20)!
  assert.equal(shared.label, '2 tabs: Docs, Docs 2')
  assert.deepEqual(shared.tabIds, ['a', 'b'])
  assert.equal(shared.members.length, 2)
  assert.deepEqual(snapshot.tabs.a, { pid: 20, cpu: 2.3, memoryKB: 150_000, sharedWith: 1 })
  assert.equal(snapshot.tabs.z, undefined, 'occupants without a live process are dropped')
})

test('app UI surfaces sharing one renderer are all named', () => {
  const shared = buildDiagnosticsSnapshot([metric(30, 'Tab', 0, 90_000)], [
    { pid: 30, kind: 'shell', label: 'toolbar' },
    { pid: 30, kind: 'shell', label: 'sidebar' },
    { pid: 30, kind: 'shell', label: 'toolbar' },
    { pid: 30, kind: 'shell', label: 'content' }
  ], 1000).rows[0]!
  assert.equal(shared.label, 'Surffish UI: toolbar, sidebar, content')
  assert.equal(shared.canKill, false)
})

test('totals add up every process', () => {
  const snapshot = buildDiagnosticsSnapshot(metrics, occupants, 1000)
  assert.equal(snapshot.totals.processes, metrics.length)
  assert.equal(snapshot.totals.renderers, 6)
  assert.equal(snapshot.totals.memoryKB, metrics.reduce((sum, entry) => sum + entry.memory.workingSetSize, 0))
  assert.equal(snapshot.totals.idleWakeups, 8 + 246 + 4 + 114 + 60 + 176)
  assert.equal(snapshot.totals.cpu, 78.5)
  assert.equal(snapshot.sampledAt, 1000)
})

test('rows sort by any column with pid as the tie breaker', () => {
  const { rows } = buildDiagnosticsSnapshot(metrics, occupants, 1000)
  assert.deepEqual(sortDiagnosticsRows(rows, 'cpu', 'desc').slice(0, 2).map((row) => row.pid), [2, 11])
  assert.deepEqual(sortDiagnosticsRows(rows, 'memory', 'desc')[0]!.pid, 1)
  assert.deepEqual(sortDiagnosticsRows(rows, 'wakeups', 'desc')[0]!.pid, 2)
  assert.deepEqual(sortDiagnosticsRows(rows, 'pid', 'asc').map((row) => row.pid), metrics.map((entry) => entry.pid))
  assert.equal(sortDiagnosticsRows(rows, 'name', 'asc')[0]!.label, '2 tabs: Docs, Docs 2')
  assert.deepEqual(sortDiagnosticsRows(rows, 'cpu', 'asc').slice(0, 2).map((row) => row.pid), [4, 22])
})

test('memory and tab hints are formatted compactly', () => {
  assert.equal(formatDiagnosticsMemory(0), '0 KB')
  assert.equal(formatDiagnosticsMemory(512), '512 KB')
  assert.equal(formatDiagnosticsMemory(86_323), '84.3 MB')
  assert.equal(formatDiagnosticsMemory(150_000), '146 MB')
  assert.equal(formatDiagnosticsMemory(1_331_000), '1.27 GB')
  assert.equal(formatTabUsageHint(undefined), '')
  assert.equal(formatTabUsageHint({ pid: 1, cpu: 3.21, memoryKB: 86_323, sharedWith: 0 }), '84 MB · 3.2% CPU')
  assert.equal(formatTabUsageHint({ pid: 1, cpu: 0, memoryKB: 150_000, sharedWith: 2 }), '146 MB · 0.0% CPU (shared with 2 tabs)')
})

test('tab occupants pair the title with the origin', () => {
  assert.deepEqual(describeTabOccupant('Example Domain', 'https://example.com/a'), { label: 'Example Domain', detail: 'example.com' })
  assert.deepEqual(describeTabOccupant('  ', 'https://example.com/a'), { label: 'example.com', detail: 'https://example.com/a' })
  assert.deepEqual(describeTabOccupant('Viewer', 'surffish-pdf-editor://editor/'), { label: 'Viewer', detail: 'surffish-pdf-editor' })
})
