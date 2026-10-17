import { describe, expect, test } from 'bun:test'
import {
  debugStallsFromEnv,
  formatSnapshot,
  formatStallLine,
  parseDebugLoggingSettings,
  shouldRotateStallLog,
  snapshotWritesSince,
  stallFromTick,
  stallLogPageLabel,
  STALL_LOG_MAX_BYTES,
  summarizeProcesses
} from './stall-log'

describe('debug logging settings', () => {
  test('off by default, booleans only', () => {
    expect(parseDebugLoggingSettings(null)).toEqual({ enabled: false })
    expect(parseDebugLoggingSettings({ enabled: true })).toEqual({ enabled: true })
    expect(parseDebugLoggingSettings({ enabled: 'yes' }, { enabled: true })).toEqual({ enabled: true })
  })
  test('SURFFISH_DEBUG_STALLS', () => {
    for (const on of ['1', 'true', 'YES', ' on ']) expect(debugStallsFromEnv(on)).toBe(true)
    for (const off of [undefined, '', '0', 'false', 'no']) expect(debugStallsFromEnv(off)).toBe(false)
  })
})

describe('stall detection', () => {
  test('reports the whole time away once the extra delay reaches the threshold', () => {
    expect(stallFromTick(100)).toBeNull()
    expect(stallFromTick(599)).toBeNull()
    expect(stallFromTick(600)).toBe(600)
    expect(stallFromTick(2412.6)).toBe(2413)
    expect(stallFromTick(Number.NaN)).toBeNull()
    expect(stallFromTick(300, 100, 150)).toBe(300)
  })
})

describe('snapshot', () => {
  test('groups processes by type, busiest first, KB to MB', () => {
    const groups = summarizeProcesses([
      { type: 'Browser', cpu: { percentCPUUsage: 3 }, memory: { workingSetSize: 200 * 1024 } },
      { type: 'Tab', cpu: { percentCPUUsage: 40.04 }, memory: { workingSetSize: 100 * 1024 } },
      { type: 'Tab', cpu: { percentCPUUsage: 10 }, memory: { workingSetSize: 50 * 1024 } },
      { type: 'Utility', serviceName: 'Network Service', cpu: { percentCPUUsage: 0 }, memory: { workingSetSize: 1024 } },
      { type: 'GPU' }
    ])
    expect(groups[0]).toEqual({ type: 'Tab', count: 2, cpu: 50, rssMB: 150 })
    expect(groups.map((group) => group.type)).toEqual(['Tab', 'Browser', 'Utility(Network Service)', 'GPU'])
  })
  test('write totals become per-line deltas', () => {
    expect(snapshotWritesSince({ files: 5, bytes: 9000, flushes: 3, flushMs: 40.4 }, { files: 2, bytes: 1000, flushes: 1, flushMs: 10 })).toEqual({ files: 3, bytes: 8000, flushes: 2, flushMs: 30 })
  })
  test('one readable line', () => {
    const text = formatSnapshot({
      processes: [{ type: 'Tab', count: 2, cpu: 50, rssMB: 1500 }, { type: 'Browser', count: 1, cpu: 3, rssMB: 200 }],
      freeMB: 512, totalMB: 16384, macPressure: 2, load: [3.5, 2, 1.25],
      windows: 1, tabs: 12, awakeTabs: 5, prerenders: 0,
      snapshotWrites: { files: 1, bytes: 2048, flushes: 1, flushMs: 12 }
    })
    expect(text).toBe('procs=3 cpu=53% rss=1.7GB [Tab×2 50% 1.5GB, Browser×1 3% 200MB] | free=512MB/16.0GB | pressure=2 | load=3.50,2.00,1.25 | windows=1 | tabs=12 awake=5 | prerender=0 | snapshotWrites=1 (2KB in 1 flush, 12ms on main)')
    expect(formatSnapshot({ processes: [], freeMB: 1, totalMB: 2, macPressure: null, load: [0, 0, 0], windows: null, tabs: null, awakeTabs: null, prerenders: null, snapshotWrites: null })).not.toContain('pressure')
  })
})

describe('log lines', () => {
  test('stamped, kind upper-cased, one line', () => {
    const line = formatStallLine(new Date(2026, 9, 17, 14, 53, 7, 5), 'stall', 'a\nb')
    expect(line).toMatch(/^2026-10-17 14:53:07\.005 [+-]\d\d:\d\d STALL a b\n$/)
  })
  test('rotation at the cap, never for an empty file', () => {
    expect(shouldRotateStallLog(0, STALL_LOG_MAX_BYTES * 2)).toBe(false)
    expect(shouldRotateStallLog(STALL_LOG_MAX_BYTES - 10, 5)).toBe(false)
    expect(shouldRotateStallLog(STALL_LOG_MAX_BYTES - 10, 11)).toBe(true)
  })
  test('pages by host only, private never named', () => {
    expect(stallLogPageLabel('https://mail.example.com/inbox/123?token=abc#x', false)).toBe('mail.example.com')
    expect(stallLogPageLabel('http://127.0.0.1:8080/secret', false)).toBe('127.0.0.1:8080')
    expect(stallLogPageLabel('https://bank.example.com/account', true)).toBe('private')
    expect(stallLogPageLabel('file:///Applications/Surffish.app/index.html?surface=toolbar', false)).toBe('shell:toolbar')
    expect(stallLogPageLabel('chrome-extension://abcdef/popup.html', false)).toBe('extension:abcdef')
    expect(stallLogPageLabel('about:blank', false)).toBe('about')
    expect(stallLogPageLabel('', false)).toBe('page')
  })
})
