import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applyCheckFailure,
  applyCheckSuccess,
  backoffDelayMs,
  BLOCKED_RETRY_MS,
  changeSummary,
  compactDiff,
  createWatcher,
  deferCheck,
  diffLines,
  dueWatchers,
  editWatcher,
  MAX_BACKOFF_MS,
  MAX_DIFF_EDITS,
  MAX_WAKE_MS,
  MAX_WATCHERS,
  MIN_WAKE_MS,
  nextWakeDelay,
  normalizeWatchSelector,
  normalizeWatchText,
  normalizeWatchUrl,
  parseWatcherList,
  summarizeWatcher,
  watchIntervalLabel,
  type DiffOp,
  type PageWatcher
} from './page-watchers.ts'

const NOW = Date.UTC(2026, 9, 13, 2, 0, 0)
const MINUTE = 60_000
const HOUR = 60 * MINUTE

function watcher(overrides: Partial<PageWatcher> = {}): PageWatcher {
  const result = createWatcher({ url: 'https://example.com/changelog', title: 'Changelog' }, [], overrides.id ?? 'w1', NOW)
  assert.equal(result.ok, true)
  if (!result.ok) throw new Error('unreachable')
  return { ...result.watcher, ...overrides }
}

/** Rebuild both sides from the ops: proves the diff is a correct edit script. */
function replay(ops: DiffOp[]): { before: string[]; after: string[] } {
  return {
    before: ops.filter((op) => op.type !== 'added').map((op) => op.text),
    after: ops.filter((op) => op.type !== 'removed').map((op) => op.text)
  }
}

test('diff: identical, pure insertions, pure deletions', () => {
  assert.deepEqual(diffLines(['a', 'b'], ['a', 'b']), [{ type: 'same', text: 'a' }, { type: 'same', text: 'b' }])
  assert.deepEqual(diffLines([], ['x', 'y']), [{ type: 'added', text: 'x' }, { type: 'added', text: 'y' }])
  assert.deepEqual(diffLines(['x'], []), [{ type: 'removed', text: 'x' }])
  assert.deepEqual(diffLines(['a', 'c'], ['a', 'b', 'c']), [{ type: 'same', text: 'a' }, { type: 'added', text: 'b' }, { type: 'same', text: 'c' }])
})

test('diff: a changed line reads as one removal and one addition, in place', () => {
  const ops = diffLines(['Price: $10', 'In stock', 'Ships today'], ['Price: $12', 'In stock', 'Ships today'])
  assert.deepEqual(ops.filter((op) => op.type !== 'same'), [{ type: 'removed', text: 'Price: $10' }, { type: 'added', text: 'Price: $12' }])
  assert.deepEqual(replay(ops), { before: ['Price: $10', 'In stock', 'Ships today'], after: ['Price: $12', 'In stock', 'Ships today'] })
})

test('diff: minimal edit script on interleaved changes (Myers)', () => {
  const before = 'A B C A B B A'.split(' ')
  const after = 'C B A B A C'.split(' ')
  const ops = diffLines(before, after)
  assert.deepEqual(replay(ops), { before, after })
  // The classic example has an edit distance of 5.
  assert.equal(ops.filter((op) => op.type !== 'same').length, 5)
})

test('diff: random edits always replay to both inputs', () => {
  let seed = 7
  const random = (): number => {
    seed = (seed * 1103515245 + 12345) % 2 ** 31
    return seed / 2 ** 31
  }
  for (let round = 0; round < 200; round++) {
    const before = Array.from({ length: Math.floor(random() * 30) }, () => `line ${Math.floor(random() * 8)}`)
    const after = before.flatMap((line) => random() < 0.15 ? [] : random() < 0.15 ? [line, `new ${Math.floor(random() * 5)}`] : [line])
    if (random() < 0.3) after.unshift('top')
    assert.deepEqual(replay(diffLines(before, after)), { before, after })
  }
})

test('diff: huge rewrites fall back to a set comparison with correct counts', () => {
  const before = Array.from({ length: MAX_DIFF_EDITS + 200 }, (_, index) => `old ${index}`)
  const after = Array.from({ length: MAX_DIFF_EDITS + 200 }, (_, index) => `new ${index}`)
  const ops = diffLines(['keep', ...before, 'tail'], ['keep', ...after, 'tail'])
  assert.equal(ops.filter((op) => op.type === 'removed').length, before.length)
  assert.equal(ops.filter((op) => op.type === 'added').length, after.length)
  assert.equal(ops[0]!.type, 'same')
  assert.equal(ops.at(-1)!.type, 'same')
})

test('compact diff keeps one line of context and caps the stored lines', () => {
  const ops = diffLines(['1', '2', '3', '4', '5', '6', '7'], ['1', '2', '3', 'four', '5', '6', '7'])
  const diff = compactDiff(ops, NOW)
  assert.deepEqual(diff.lines, [
    { type: 'context', text: '3' },
    { type: 'removed', text: '4' },
    { type: 'added', text: 'four' },
    { type: 'context', text: '5' }
  ])
  assert.equal(diff.added, 1)
  assert.equal(diff.removed, 1)
  assert.equal(diff.truncated, false)
  const big = compactDiff(Array.from({ length: 50 }, (_, index) => ({ type: 'added' as const, text: String(index) })), NOW, 1, 10)
  assert.equal(big.lines.length, 10)
  assert.equal(big.added, 50)
  assert.equal(big.truncated, true)
  assert.equal(changeSummary(diff), '1 line added, 1 removed')
  assert.equal(changeSummary({ added: 3, removed: 0 }), '3 lines added')
})

test('text normalization: whitespace, blank lines, caps', () => {
  assert.deepEqual(normalizeWatchText('  Hello\u00a0  world \n\n\t\nSecond\r\nThird  '), ['Hello world', 'Second', 'Third'])
  assert.equal(normalizeWatchText('x'.repeat(5000))[0]!.length, 1000)
})

test('first check takes the baseline without reporting a change', () => {
  const first = applyCheckSuccess(watcher(), ['a', 'b'], NOW)
  assert.equal(first.changed, false)
  assert.equal(first.watcher.snapshot, 'a\nb')
  assert.equal(first.watcher.lastCheckedAt, NOW)
  assert.equal(first.watcher.nextCheckAt, NOW + HOUR)
  assert.equal(first.watcher.unseen, false)
  const same = applyCheckSuccess(first.watcher, ['a', 'b'], NOW + HOUR)
  assert.equal(same.changed, false)
  assert.equal(same.watcher.lastChangedAt, null)
})

test('a changed check stores the diff, marks it unseen and resets errors', () => {
  const base = applyCheckSuccess(watcher({ consecutiveErrors: 0 }), ['v1.0', 'notes'], NOW).watcher
  const failing = applyCheckFailure(base, 'HTTP 503', NOW + HOUR)
  const next = applyCheckSuccess(failing, ['v1.1', 'v1.0', 'notes'], NOW + 2 * HOUR)
  assert.equal(next.changed, true)
  assert.equal(next.watcher.unseen, true)
  assert.equal(next.watcher.lastChangedAt, NOW + 2 * HOUR)
  assert.equal(next.watcher.lastDiff?.added, 1)
  assert.equal(next.watcher.lastDiff?.removed, 0)
  assert.equal(next.watcher.consecutiveErrors, 0)
  assert.equal(next.watcher.lastError, null)
  assert.equal(next.watcher.snapshot, 'v1.1\nv1.0\nnotes')
})

test('backoff doubles per error, caps at 48h and never drops below the interval', () => {
  assert.equal(backoffDelayMs(15, 0), 15 * MINUTE)
  assert.equal(backoffDelayMs(15, 1), 30 * MINUTE)
  assert.equal(backoffDelayMs(15, 3), 2 * HOUR)
  assert.equal(backoffDelayMs(15, 40), MAX_BACKOFF_MS)
  assert.equal(backoffDelayMs(1440, 1), 48 * HOUR)
  assert.equal(backoffDelayMs(1440, 5), MAX_BACKOFF_MS)
  const once = applyCheckFailure(watcher({ intervalMinutes: 60 }), 'ERR_NAME_NOT_RESOLVED', NOW)
  assert.equal(once.consecutiveErrors, 1)
  assert.equal(once.nextCheckAt, NOW + 2 * HOUR)
  const twice = applyCheckFailure(once, 'ERR_NAME_NOT_RESOLVED', NOW + 2 * HOUR)
  assert.equal(twice.nextCheckAt, NOW + 2 * HOUR + 4 * HOUR)
  // The baseline survives errors, so the next good check still compares against it.
  assert.equal(applyCheckFailure({ ...once, snapshot: 'kept' }, 'x', NOW).snapshot, 'kept')
})

test('a blocked network defers the check without counting an error', () => {
  const blocked = deferCheck(watcher({ consecutiveErrors: 2 }), 'Proxy kill switch', NOW)
  assert.equal(blocked.consecutiveErrors, 2)
  assert.equal(blocked.nextCheckAt, NOW + BLOCKED_RETRY_MS)
  assert.equal(blocked.lastError, 'Proxy kill switch')
})

test('scheduling: due order, paused and running watchers, wake clamping', () => {
  const a = watcher({ id: 'a', nextCheckAt: NOW - 10 * MINUTE })
  const b = watcher({ id: 'b', nextCheckAt: NOW - HOUR })
  const c = watcher({ id: 'c', nextCheckAt: NOW + HOUR })
  const paused = watcher({ id: 'p', nextCheckAt: NOW - 2 * HOUR, paused: true })
  assert.deepEqual(dueWatchers([a, b, c, paused], NOW).map((entry) => entry.id), ['b', 'a'])
  assert.deepEqual(dueWatchers([a, b, c], NOW, new Set(['b'])).map((entry) => entry.id), ['a'])
  assert.equal(nextWakeDelay([c], NOW), HOUR)
  assert.equal(nextWakeDelay([a], NOW), MIN_WAKE_MS)
  assert.equal(nextWakeDelay([watcher({ nextCheckAt: NOW + 30 * HOUR })], NOW), MAX_WAKE_MS)
  assert.equal(nextWakeDelay([paused], NOW), null)
  assert.equal(nextWakeDelay([], NOW), null)
})

test('create: validates URL, selector, duplicates and the cap', () => {
  assert.equal(createWatcher({ url: 'file:///etc/hosts' }, [], 'x', NOW).ok, false)
  assert.equal(createWatcher({ url: 'https://user:pw@example.com/' }, [], 'x', NOW).ok, false)
  assert.equal(createWatcher({ url: 'https://example.com/', selector: 'div { color: red }' }, [], 'x', NOW).ok, false)
  const first = watcher()
  assert.equal(createWatcher({ url: 'https://example.com/changelog#latest' }, [first], 'x', NOW).ok, false)
  assert.equal(createWatcher({ url: 'https://example.com/changelog', selector: '#latest' }, [first], 'x', NOW).ok, true)
  const full = Array.from({ length: MAX_WATCHERS }, (_, index) => watcher({ id: `w${index}` }))
  const capped = createWatcher({ url: 'https://other.example/' }, full, 'x', NOW)
  assert.equal(capped.ok, false)
  assert.match(capped.ok ? '' : capped.error, /up to 50/)
  const created = createWatcher({ url: 'https://example.org/page', intervalMinutes: 15 }, [], 'x', NOW)
  assert.equal(created.ok && created.watcher.title, 'example.org')
  assert.equal(created.ok && created.watcher.nextCheckAt, NOW)
  assert.equal(created.ok && created.watcher.intervalMinutes, 15)
})

test('edit: interval reschedules, target changes reset the baseline, pause/resume, seen', () => {
  const checked = applyCheckSuccess(watcher(), ['a'], NOW).watcher
  const faster = editWatcher(checked, { intervalMinutes: 15 }, NOW + 5 * MINUTE)
  assert.equal(faster.ok && faster.watcher.nextCheckAt, NOW + 15 * MINUTE)
  assert.equal(faster.ok && faster.watcher.snapshot, 'a')
  const retargeted = editWatcher({ ...checked, unseen: true }, { selector: '#price' }, NOW + 5 * MINUTE)
  assert.equal(retargeted.ok && retargeted.watcher.snapshot, null)
  assert.equal(retargeted.ok && retargeted.watcher.unseen, false)
  assert.equal(retargeted.ok && retargeted.watcher.nextCheckAt, NOW + 5 * MINUTE)
  // An empty selector means the main text, which is what it already watched: baseline kept.
  const cleared = editWatcher(checked, { selector: '  ' }, NOW)
  assert.equal(cleared.ok && cleared.watcher.selector, null)
  assert.equal(cleared.ok && cleared.watcher.snapshot, 'a')
  assert.equal(editWatcher(checked, { intervalMinutes: 7 as never }, NOW).ok, false)
  assert.equal(editWatcher(checked, { selector: 'a{' }, NOW).ok, false)
  const paused = editWatcher(checked, { paused: true }, NOW)
  assert.equal(paused.ok && paused.watcher.paused, true)
  if (!paused.ok) return
  const resumed = editWatcher({ ...paused.watcher, nextCheckAt: NOW - 3 * HOUR }, { paused: false }, NOW)
  assert.equal(resumed.ok && resumed.watcher.nextCheckAt, NOW)
  const seen = editWatcher({ ...checked, unseen: true }, { seen: true }, NOW)
  assert.equal(seen.ok && seen.watcher.unseen, false)
})

test('stored list: survives junk, drops duplicates and bad entries, caps the count', () => {
  const good = applyCheckSuccess(watcher(), ['a'], NOW).watcher
  const parsed = parseWatcherList({ version: 1, watchers: [good, good, { id: 'bad', url: 'javascript:alert(1)' }, 42, { ...good, id: 'w2', intervalMinutes: 3, consecutiveErrors: -4 }] }, NOW)
  assert.deepEqual(parsed.map((entry) => entry.id), ['w1', 'w2'])
  assert.equal(parsed[1]!.intervalMinutes, 60)
  assert.equal(parsed[1]!.consecutiveErrors, 0)
  assert.deepEqual(parseWatcherList(null, NOW), [])
  assert.deepEqual(parseWatcherList('nope', NOW), [])
  const many = Array.from({ length: MAX_WATCHERS + 5 }, (_, index) => ({ ...good, id: `w${index}` }))
  assert.equal(parseWatcherList({ watchers: many }, NOW).length, MAX_WATCHERS)
  const summary = summarizeWatcher(good)
  assert.equal('snapshot' in summary, false)
  assert.equal(summary.snapshotLines, 1)
})

test('URL and selector normalization, interval labels', () => {
  assert.equal(normalizeWatchUrl(' https://Example.com/a#frag '), 'https://example.com/a')
  assert.equal(normalizeWatchUrl('ftp://example.com/'), null)
  assert.equal(normalizeWatchSelector('  main > .price  '), 'main > .price')
  assert.equal(normalizeWatchSelector('x'.repeat(600)), null)
  assert.equal(normalizeWatchSelector('a\nb'), null)
  assert.equal(watchIntervalLabel(15), 'Every 15 minutes')
  assert.equal(watchIntervalLabel(60), 'Every hour')
  assert.equal(watchIntervalLabel(360), 'Every 6 hours')
  assert.equal(watchIntervalLabel(1440), 'Every day')
})
