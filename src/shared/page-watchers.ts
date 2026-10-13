// Page watchers: the stored record, scheduling with error backoff, and a line diff of the watched
// text. Pure and side-effect free (main runs the checks), so it is unit-testable.

export const WATCH_INTERVALS = [15, 60, 360, 1440] as const
export type WatchIntervalMinutes = (typeof WATCH_INTERVALS)[number]
export const DEFAULT_WATCH_INTERVAL: WatchIntervalMinutes = 60
export const MAX_WATCHERS = 50
/** Checks running at once; the rest wait their turn. */
export const MAX_CONCURRENT_CHECKS = 2
/** Errors push the next check out exponentially, up to this. */
export const MAX_BACKOFF_MS = 48 * 60 * 60 * 1000
/** A check skipped because the network is blocked (proxy kill switch) is retried after this. */
export const BLOCKED_RETRY_MS = 5 * 60 * 1000
/** Never wake the scheduler more often than this, or sleep longer (clock changes, system sleep). */
export const MIN_WAKE_MS = 1_000
export const MAX_WAKE_MS = 6 * 60 * 60 * 1000
export const MAX_SNAPSHOT_CHARS = 200_000
export const MAX_SNAPSHOT_LINES = 5_000
export const MAX_LINE_CHARS = 1_000
export const MAX_DIFF_ENTRIES = 400
export const MAX_SELECTOR_CHARS = 500

export function isWatchInterval(value: unknown): value is WatchIntervalMinutes {
  return typeof value === 'number' && (WATCH_INTERVALS as readonly number[]).includes(value)
}

export function watchIntervalLabel(minutes: WatchIntervalMinutes): string {
  return minutes < 60 ? `Every ${minutes} minutes` : minutes === 60 ? 'Every hour' : minutes === 1440 ? 'Every day' : `Every ${minutes / 60} hours`
}

export type WatchDiffLine = { type: 'added' | 'removed' | 'context'; text: string }

export interface WatchDiff {
  at: number
  added: number
  removed: number
  /** Changed lines with one line of context, in page order. */
  lines: WatchDiffLine[]
  truncated: boolean
}

export interface PageWatcher {
  id: string
  url: string
  title: string
  /** CSS selector of the watched element, or null for the page's main text. */
  selector: string | null
  intervalMinutes: WatchIntervalMinutes
  /** Load the page in a hidden window and run its JavaScript before reading the text. */
  renderJs: boolean
  paused: boolean
  createdAt: number
  lastCheckedAt: number | null
  lastChangedAt: number | null
  nextCheckAt: number
  lastError: string | null
  consecutiveErrors: number
  /** Normalized text of the last good check; the baseline the next check is compared with. */
  snapshot: string | null
  lastDiff: WatchDiff | null
  /** A change the user hasn't looked at yet (the Watchers badge). */
  unseen: boolean
}

/** What the renderer gets: everything but the stored snapshot text. */
export type PageWatcherSummary = Omit<PageWatcher, 'snapshot'> & { snapshotLines: number }

export function summarizeWatcher(watcher: PageWatcher): PageWatcherSummary {
  const { snapshot, ...rest } = watcher
  return { ...rest, snapshotLines: snapshot ? snapshot.split('\n').length : 0 }
}

export function normalizeWatchUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 4096) return null
  try {
    const url = new URL(value.trim())
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password) return null
    url.hash = ''
    return url.toString()
  } catch {
    return null
  }
}

/** Syntax gate only (length, no braces/control characters); main also parses it for real. */
export function normalizeWatchSelector(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const selector = value.trim()
  if (!selector || selector.length > MAX_SELECTOR_CHARS || /[{}\u0000-\u001f]/.test(selector)) return null
  return selector
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function parseDiff(value: unknown): WatchDiff | null {
  if (typeof value !== 'object' || value === null) return null
  const record = value as Record<string, unknown>
  const at = finite(record.at)
  if (at === null || !Array.isArray(record.lines)) return null
  const lines: WatchDiffLine[] = []
  for (const line of record.lines.slice(0, MAX_DIFF_ENTRIES)) {
    if (typeof line !== 'object' || line === null) continue
    const entry = line as Record<string, unknown>
    if ((entry.type === 'added' || entry.type === 'removed' || entry.type === 'context') && typeof entry.text === 'string') lines.push({ type: entry.type, text: entry.text.slice(0, MAX_LINE_CHARS) })
  }
  return { at, added: finite(record.added) ?? 0, removed: finite(record.removed) ?? 0, lines, truncated: record.truncated === true }
}

/** One stored watcher, or null when it is unusable. */
export function parseWatcher(value: unknown, now: number): PageWatcher | null {
  if (typeof value !== 'object' || value === null) return null
  const record = value as Record<string, unknown>
  const url = normalizeWatchUrl(record.url)
  if (typeof record.id !== 'string' || !/^[A-Za-z0-9-]{1,64}$/.test(record.id) || !url) return null
  const lastCheckedAt = finite(record.lastCheckedAt)
  const intervalMinutes = isWatchInterval(record.intervalMinutes) ? record.intervalMinutes : DEFAULT_WATCH_INTERVAL
  const snapshot = typeof record.snapshot === 'string' ? record.snapshot.slice(0, MAX_SNAPSHOT_CHARS) : null
  return {
    id: record.id,
    url,
    title: typeof record.title === 'string' && record.title.trim() ? record.title.trim().slice(0, 300) : hostLabel(url),
    selector: record.selector === null ? null : normalizeWatchSelector(record.selector),
    intervalMinutes,
    renderJs: record.renderJs === true,
    paused: record.paused === true,
    createdAt: finite(record.createdAt) ?? now,
    lastCheckedAt,
    lastChangedAt: finite(record.lastChangedAt),
    nextCheckAt: finite(record.nextCheckAt) ?? now,
    lastError: typeof record.lastError === 'string' ? record.lastError.slice(0, 500) : null,
    consecutiveErrors: Math.max(0, Math.min(100, Math.floor(finite(record.consecutiveErrors) ?? 0))),
    snapshot,
    lastDiff: parseDiff(record.lastDiff),
    unseen: record.unseen === true
  }
}

export function parseWatcherList(value: unknown, now: number): PageWatcher[] {
  const list = typeof value === 'object' && value !== null && Array.isArray((value as { watchers?: unknown }).watchers)
    ? (value as { watchers: unknown[] }).watchers
    : Array.isArray(value) ? value : []
  const seen = new Set<string>()
  const watchers: PageWatcher[] = []
  for (const entry of list) {
    const watcher = parseWatcher(entry, now)
    if (!watcher || seen.has(watcher.id)) continue
    seen.add(watcher.id)
    watchers.push(watcher)
    if (watchers.length >= MAX_WATCHERS) break
  }
  return watchers
}

export function hostLabel(url: string): string {
  try {
    return new URL(url).hostname || url
  } catch {
    return url
  }
}

export interface NewWatcherInput {
  url: string
  title?: string
  selector?: string | null
  intervalMinutes?: WatchIntervalMinutes
  renderJs?: boolean
}

export type CreateWatcherResult = { ok: true; watcher: PageWatcher } | { ok: false; error: string }

export function createWatcher(input: NewWatcherInput, existing: readonly PageWatcher[], id: string, now: number): CreateWatcherResult {
  if (existing.length >= MAX_WATCHERS) return { ok: false, error: `You can watch up to ${MAX_WATCHERS} pages. Delete one to add another.` }
  const url = normalizeWatchUrl(input.url)
  if (!url) return { ok: false, error: 'Only http and https pages can be watched.' }
  const selector = input.selector === undefined || input.selector === null ? null : normalizeWatchSelector(input.selector)
  if (input.selector && !selector) return { ok: false, error: 'That CSS selector is not valid.' }
  if (existing.some((watcher) => watcher.url === url && watcher.selector === selector)) return { ok: false, error: 'You are already watching this.' }
  return {
    ok: true,
    watcher: {
      id,
      url,
      title: input.title?.trim().slice(0, 300) || hostLabel(url),
      selector,
      intervalMinutes: input.intervalMinutes && isWatchInterval(input.intervalMinutes) ? input.intervalMinutes : DEFAULT_WATCH_INTERVAL,
      renderJs: input.renderJs === true,
      paused: false,
      createdAt: now,
      lastCheckedAt: null,
      lastChangedAt: null,
      // The first check takes the baseline right away.
      nextCheckAt: now,
      lastError: null,
      consecutiveErrors: 0,
      snapshot: null,
      lastDiff: null,
      unseen: false
    }
  }
}

export interface WatcherPatch {
  title?: string
  selector?: string | null
  intervalMinutes?: WatchIntervalMinutes
  renderJs?: boolean
  paused?: boolean
  seen?: boolean
}

export type EditWatcherResult = { ok: true; watcher: PageWatcher } | { ok: false; error: string }

/** Apply a user edit. What is watched changing (selector, rendering) resets the baseline. */
export function editWatcher(watcher: PageWatcher, patch: WatcherPatch, now: number): EditWatcherResult {
  const next: PageWatcher = { ...watcher }
  if (typeof patch.title === 'string') next.title = patch.title.trim().slice(0, 300) || hostLabel(watcher.url)
  if (patch.selector !== undefined) {
    const selector = patch.selector === null || patch.selector.trim() === '' ? null : normalizeWatchSelector(patch.selector)
    if (patch.selector && patch.selector.trim() && !selector) return { ok: false, error: 'That CSS selector is not valid.' }
    next.selector = selector
  }
  if (typeof patch.renderJs === 'boolean') next.renderJs = patch.renderJs
  if (patch.intervalMinutes !== undefined) {
    if (!isWatchInterval(patch.intervalMinutes)) return { ok: false, error: 'Pick one of the listed intervals.' }
    next.intervalMinutes = patch.intervalMinutes
  }
  const targetChanged = next.selector !== watcher.selector || next.renderJs !== watcher.renderJs
  if (targetChanged) {
    next.snapshot = null
    next.lastDiff = null
    next.unseen = false
    next.lastError = null
    next.consecutiveErrors = 0
    next.nextCheckAt = now
  } else if (next.intervalMinutes !== watcher.intervalMinutes) {
    next.nextCheckAt = scheduleAfterSuccess(next, next.lastCheckedAt ?? now)
  }
  if (typeof patch.paused === 'boolean' && patch.paused !== watcher.paused) {
    next.paused = patch.paused
    // Resuming an overdue watcher checks it now; otherwise it keeps its slot.
    if (!patch.paused) next.nextCheckAt = Math.max(now, Math.min(next.nextCheckAt, now + intervalMs(next)))
  }
  if (patch.seen === true) next.unseen = false
  return { ok: true, watcher: next }
}

export function intervalMs(watcher: Pick<PageWatcher, 'intervalMinutes'>): number {
  return watcher.intervalMinutes * 60_000
}

function scheduleAfterSuccess(watcher: Pick<PageWatcher, 'intervalMinutes'>, checkedAt: number): number {
  return checkedAt + intervalMs(watcher)
}

/** Delay after `errors` failures in a row: the interval doubled per error, capped, never below the interval. */
export function backoffDelayMs(intervalMinutes: WatchIntervalMinutes, errors: number): number {
  const base = intervalMinutes * 60_000
  if (errors <= 0) return base
  const scaled = base * 2 ** Math.min(errors, 16)
  return Math.max(base, Math.min(scaled, MAX_BACKOFF_MS))
}

/** Active watchers whose check is due, most overdue first. */
export function dueWatchers(watchers: readonly PageWatcher[], now: number, running: ReadonlySet<string> = new Set()): PageWatcher[] {
  return watchers
    .filter((watcher) => !watcher.paused && !running.has(watcher.id) && watcher.nextCheckAt <= now)
    .sort((a, b) => a.nextCheckAt - b.nextCheckAt)
}

/** How long the scheduler may sleep, or null when there is nothing to wait for. */
export function nextWakeDelay(watchers: readonly PageWatcher[], now: number, running: ReadonlySet<string> = new Set()): number | null {
  let earliest: number | null = null
  for (const watcher of watchers) {
    if (watcher.paused || running.has(watcher.id)) continue
    if (earliest === null || watcher.nextCheckAt < earliest) earliest = watcher.nextCheckAt
  }
  if (earliest === null) return null
  return Math.min(MAX_WAKE_MS, Math.max(MIN_WAKE_MS, earliest - now))
}

/** Split page text into comparable lines: trimmed, whitespace collapsed, empties dropped, capped. */
export function normalizeWatchText(value: string): string[] {
  const lines: string[] = []
  let total = 0
  for (const raw of value.split(/\r?\n|\r|\u2028|\u2029/)) {
    const line = raw.replace(/[\s\u00a0\u200b]+/g, ' ').trim().slice(0, MAX_LINE_CHARS)
    if (!line) continue
    total += line.length + 1
    if (lines.length >= MAX_SNAPSHOT_LINES || total > MAX_SNAPSHOT_CHARS) break
    lines.push(line)
  }
  return lines
}

export type DiffOp = { type: 'same' | 'added' | 'removed'; text: string }

/** Edit distance beyond which the exact diff is abandoned for a cheaper set comparison. */
export const MAX_DIFF_EDITS = 1_000

/**
 * Line diff (Myers' O((N+M)D) algorithm) after trimming the common head and tail. Very different
 * inputs fall back to a multiset comparison: correct added/removed lines, approximate order.
 */
export function diffLines(before: readonly string[], after: readonly string[]): DiffOp[] {
  let start = 0
  while (start < before.length && start < after.length && before[start] === after[start]) start++
  let endBefore = before.length
  let endAfter = after.length
  while (endBefore > start && endAfter > start && before[endBefore - 1] === after[endAfter - 1]) {
    endBefore--
    endAfter--
  }
  const head: DiffOp[] = before.slice(0, start).map((text) => ({ type: 'same', text }))
  const tail: DiffOp[] = before.slice(endBefore).map((text) => ({ type: 'same', text }))
  const a = before.slice(start, endBefore)
  const b = after.slice(start, endAfter)
  const middle = myers(a, b) ?? multisetDiff(a, b)
  return [...head, ...middle, ...tail]
}

function myers(a: readonly string[], b: readonly string[]): DiffOp[] | null {
  const n = a.length
  const m = b.length
  if (n === 0) return b.map((text) => ({ type: 'added', text }))
  if (m === 0) return a.map((text) => ({ type: 'removed', text }))
  const max = Math.min(n + m, MAX_DIFF_EDITS)
  const offset = max + 1
  const v = new Int32Array(2 * max + 3)
  const trace: Int32Array[] = []
  for (let d = 0; d <= max; d++) {
    trace.push(v.slice())
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[offset + k - 1]! < v[offset + k + 1]!) ? v[offset + k + 1]! : v[offset + k - 1]! + 1
      let y = x - k
      while (x < n && y < m && a[x] === b[y]) {
        x++
        y++
      }
      v[offset + k] = x
      if (x >= n && y >= m) return backtrack(trace, a, b, offset, d)
    }
  }
  return null
}

function backtrack(trace: Int32Array[], a: readonly string[], b: readonly string[], offset: number, depth: number): DiffOp[] {
  const ops: DiffOp[] = []
  let x = a.length
  let y = b.length
  for (let d = depth; d > 0; d--) {
    const v = trace[d]!
    const k = x - y
    const prevK = k === -d || (k !== d && v[offset + k - 1]! < v[offset + k + 1]!) ? k + 1 : k - 1
    const prevX = v[offset + prevK]!
    const prevY = prevX - prevK
    while (x > prevX && y > prevY) {
      ops.push({ type: 'same', text: a[--x]! })
      y--
    }
    if (x === prevX) ops.push({ type: 'added', text: b[--y]! })
    else ops.push({ type: 'removed', text: a[--x]! })
  }
  while (x > 0 && y > 0) {
    ops.push({ type: 'same', text: a[--x]! })
    y--
  }
  return ops.reverse()
}

function multisetDiff(a: readonly string[], b: readonly string[]): DiffOp[] {
  const remaining = new Map<string, number>()
  for (const line of b) remaining.set(line, (remaining.get(line) ?? 0) + 1)
  const ops: DiffOp[] = []
  const kept = new Map<string, number>()
  for (const line of a) {
    const count = remaining.get(line) ?? 0
    if (count > 0) {
      remaining.set(line, count - 1)
      kept.set(line, (kept.get(line) ?? 0) + 1)
    } else ops.push({ type: 'removed', text: line })
  }
  for (const line of b) {
    const count = kept.get(line) ?? 0
    if (count > 0) kept.set(line, count - 1)
    else ops.push({ type: 'added', text: line })
  }
  return ops
}

/** Changed lines with `context` unchanged lines around each run; capped for storage. */
export function compactDiff(ops: readonly DiffOp[], at: number, context = 1, maxEntries = MAX_DIFF_ENTRIES): WatchDiff {
  let added = 0
  let removed = 0
  const keep = new Uint8Array(ops.length)
  ops.forEach((op, index) => {
    if (op.type === 'same') return
    if (op.type === 'added') added++
    else removed++
    for (let i = Math.max(0, index - context); i <= Math.min(ops.length - 1, index + context); i++) keep[i] = 1
  })
  const lines: WatchDiffLine[] = []
  let truncated = false
  for (let index = 0; index < ops.length; index++) {
    if (!keep[index]) continue
    if (lines.length >= maxEntries) {
      truncated = true
      break
    }
    const op = ops[index]!
    lines.push({ type: op.type === 'same' ? 'context' : op.type, text: op.text })
  }
  return { at, added, removed, lines, truncated }
}

export interface CheckOutcome {
  watcher: PageWatcher
  /** The text differs from the previous good check (never true for the first, baseline check). */
  changed: boolean
}

/** Record a successful check: compare with the baseline, store the new one, schedule the next. */
export function applyCheckSuccess(watcher: PageWatcher, lines: readonly string[], now: number): CheckOutcome {
  const snapshot = lines.join('\n')
  const base: PageWatcher = {
    ...watcher,
    lastCheckedAt: now,
    nextCheckAt: scheduleAfterSuccess(watcher, now),
    lastError: null,
    consecutiveErrors: 0
  }
  if (watcher.snapshot === null) return { watcher: { ...base, snapshot }, changed: false }
  if (watcher.snapshot === snapshot) return { watcher: base, changed: false }
  const previous = watcher.snapshot ? watcher.snapshot.split('\n') : []
  const diff = compactDiff(diffLines(previous, lines), now)
  if (diff.added === 0 && diff.removed === 0) return { watcher: { ...base, snapshot }, changed: false }
  return { watcher: { ...base, snapshot, lastDiff: diff, lastChangedAt: now, unseen: true }, changed: true }
}

/** Record a failed check and back off. The baseline is kept, so the next good check still compares. */
export function applyCheckFailure(watcher: PageWatcher, error: string, now: number): PageWatcher {
  const consecutiveErrors = Math.min(100, watcher.consecutiveErrors + 1)
  return {
    ...watcher,
    lastCheckedAt: now,
    lastError: error.slice(0, 500),
    consecutiveErrors,
    nextCheckAt: now + backoffDelayMs(watcher.intervalMinutes, consecutiveErrors)
  }
}

/** The check couldn't run at all (network blocked): try again soon, without counting an error. */
export function deferCheck(watcher: PageWatcher, reason: string, now: number, delayMs = BLOCKED_RETRY_MS): PageWatcher {
  return { ...watcher, lastError: reason.slice(0, 500), nextCheckAt: now + Math.min(delayMs, intervalMs(watcher)) }
}

export function changeSummary(diff: Pick<WatchDiff, 'added' | 'removed'>): string {
  const parts: string[] = []
  if (diff.added) parts.push(`${diff.added} line${diff.added === 1 ? '' : 's'} added`)
  if (diff.removed) parts.push(`${diff.removed} removed`)
  return parts.join(', ') || 'Changed'
}
