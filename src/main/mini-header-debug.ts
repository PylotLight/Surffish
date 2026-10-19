import { app } from 'electron'
import { appendFile, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { BaseWindow, View, WebContents } from 'electron'

/**
 * Opt-in trace of everything that could make a mini window's header (or the menu bar popout's strip)
 * flash, for catching on a real Mac what a smoke can't model. Off by default and free while off (one
 * boolean check per call site; the native tracers are only installed while it is on).
 *
 * On: SURFFISH_DEBUG_HEADER=1 in the environment at launch, or ⌘K → "Start Logging Mini Window Header
 * Events". Written (timestamped, buffered, appended) to <userData>/logs/mini-header-debug.log
 * (packaged macOS: ~/Library/Application Support/Surffish/logs/mini-header-debug.log).
 *
 * What it records:
 *  - every header state push (and which fields changed), every update the gate dropped or held;
 *  - every header DOM write, class toggle, focus/blur/hover and theme change, from the header page;
 *  - every addChildView / removeChildView / setBounds / setVisible / setBackgroundColor on a mini
 *    window and its views (page views included, so browser.ts paths show too), and the window's own
 *    setBounds / setOpacity / setBackgroundColor / setVibrancy / setBackgroundMaterial / show / hide /
 *    focus / setAlwaysOnTop / setVisibleOnAllWorkspaces, plus its focus / blur / show / hide events;
 *  - header page (re)loads and crashes, and the tab page's loading / title / icon / frame events;
 *  - (macOS) menu bar icon clicks, and for every panel shown (mini, popout, header panel, edge handle)
 *    whether it came up on the active Space, its collection behaviour before/after and whether the
 *    MoveToActiveSpace fallback ran (mac-panel.ts), plus native addon load failures;
 *  - (macOS) menu bar popout blurs and hides around Space switches: the verdict (click-away hides,
 *    Space change keeps it, held for a moment), mouse button state, how long since the last Space
 *    change, whether it is still ordered in / on the active Space / key, and the quiet key restore.
 */

const LOG_NAME = 'mini-header-debug.log'
const FLUSH_MS = 250

let enabled = process.env['SURFFISH_DEBUG_HEADER'] === '1'
let buffer: string[] = []
let flushTimer: ReturnType<typeof setTimeout> | null = null
let directoryReady = false
const listeners = new Set<(on: boolean) => void>()
const started = Date.now()

export function miniHeaderDebugEnabled(): boolean {
  return enabled
}

export function miniHeaderDebugLogPath(): string {
  return join(app.getPath('userData'), 'logs', LOG_NAME)
}

/** Called with the new state whenever logging is turned on or off (mini-window.ts installs / reports). */
export function onMiniHeaderDebugChange(listener: (on: boolean) => void): void {
  listeners.add(listener)
}

export function setMiniHeaderDebug(on: boolean): string {
  if (enabled !== on) {
    if (!on) headerDebug('debug', 'logging off')
    enabled = on
    if (on) headerDebug('debug', `logging on (Surffish ${app.getVersion()}, Electron ${process.versions.electron}, ${process.platform} ${process.arch})`)
    for (const listener of listeners) listener(on)
    if (!on) flush()
  }
  return miniHeaderDebugLogPath()
}

function flush(): void {
  flushTimer = null
  if (buffer.length === 0) return
  const lines = buffer.join('')
  buffer = []
  try {
    const path = miniHeaderDebugLogPath()
    if (!directoryReady) {
      mkdirSync(join(path, '..'), { recursive: true })
      directoryReady = true
    }
    appendFile(path, lines, () => undefined)
  } catch {
    // No userData yet or not writable: nothing to do in a debug trace.
  }
}

function describe(value: unknown): string {
  if (value === undefined) return ''
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

const pad = (value: number, width = 2): string => String(value).padStart(width, '0')

/** Local wall clock with its UTC offset: 2026-10-17 14:53:07.123 +11:00. */
function stamp(date: Date): string {
  const offset = -date.getTimezoneOffset()
  const sign = offset >= 0 ? '+' : '-'
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)} ${sign}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`
}

/** One timestamped line (wall clock and ms since launch). No-op while logging is off. */
export function headerDebug(kind: string, detail?: unknown): void {
  if (!enabled) return
  const now = new Date()
  buffer.push(`${stamp(now)} +${now.getTime() - started}ms ${kind} ${describe(detail)}\n`)
  flushTimer ??= setTimeout(flush, FLUSH_MS)
}

// ---------------------------------------------------------------------------
// Native tracers: instance-level wrappers on one mini window, its content view and the views added to
// it. Installed only while logging is on; removed (originals restored) when it goes off.

type Restore = () => void
const traced = new WeakMap<object, Restore[]>()

function rectOf(value: unknown): string {
  const rect = value as { x?: number; y?: number; width?: number; height?: number } | undefined
  return rect && typeof rect === 'object' ? `${rect.x},${rect.y} ${rect.width}x${rect.height}` : describe(value)
}

function wrap(target: object, name: string, label: () => string, format: (args: unknown[], self: Record<string, unknown>) => string, after?: (args: unknown[]) => void): void {
  const self = target as Record<string, unknown>
  const original = self[name]
  if (typeof original !== 'function') return
  const restores = traced.get(target) ?? []
  const wrapped = function (this: unknown, ...args: unknown[]): unknown {
    if (enabled) headerDebug('native', `${label()}.${name}(${format(args, self)})`)
    const result = (original as (...a: unknown[]) => unknown).apply(this, args)
    after?.(args)
    return result
  }
  self[name] = wrapped
  restores.push(() => { if (self[name] === wrapped) delete self[name] })
  traced.set(target, restores)
}

function untrace(target: object): void {
  for (const restore of traced.get(target) ?? []) restore()
  traced.delete(target)
}

/** A short name for a view: the header, the page (its host), or a plain view. */
export type ViewNamer = (view: View) => string

function traceView(view: View, name: ViewNamer): void {
  if (traced.has(view)) return
  traced.set(view, [])
  wrap(view, 'setBounds', () => name(view), (args, self) => {
    const next = rectOf(args[0])
    const getBounds = self['getBounds'] as (() => unknown) | undefined
    let same = ''
    try { same = getBounds && rectOf(getBounds.call(view)) === next ? ' (same)' : '' } catch { /* destroyed */ }
    return next + same
  })
  wrap(view, 'setVisible', () => name(view), (args, self) => {
    const getVisible = self['getVisible'] as (() => boolean) | undefined
    let same = ''
    try { same = getVisible && getVisible.call(view) === args[0] ? ' (same)' : '' } catch { /* destroyed */ }
    return `${describe(args[0])}${same}`
  })
  wrap(view, 'setBackgroundColor', () => name(view), (args) => describe(args[0]))
}

/** Trace one mini window (and its views as they are added). `label`: what to call it in the log. */
export function traceMiniWindow(window: BaseWindow, label: () => string, name: ViewNamer): void {
  if (!enabled || window.isDestroyed() || traced.has(window)) return
  traced.set(window, [])
  const plain = (args: unknown[]): string => args.map(describe).join(', ')
  for (const method of ['setOpacity', 'setBackgroundColor', 'setVibrancy', 'setBackgroundMaterial', 'showInactive', 'show', 'hide', 'focus', 'blur', 'setAlwaysOnTop', 'setVisibleOnAllWorkspaces', 'setContentView', 'setTitle']) wrap(window, method, label, plain)
  wrap(window, 'setBounds', label, (args) => rectOf(args[0]))
  const content = window.contentView
  traced.set(content, [])
  wrap(content, 'addChildView', label, (args) => {
    const view = args[0] as View
    const index = args[1]
    const already = content.children.includes(view)
    return `${name(view)}${index === undefined ? '' : ` at ${describe(index)}`}${already ? ' (already attached: re-stacked)' : ''}; before: [${content.children.map(name).join(', ')}]`
  }, (args) => traceView(args[0] as View, name))
  wrap(content, 'removeChildView', label, (args) => name(args[0] as View))
  for (const view of content.children) traceView(view, name)
  const events: Array<[string, () => void]> = []
  for (const event of ['focus', 'blur', 'show', 'hide']) {
    const listener = (): void => headerDebug('window', `${label()} ${event}`)
    window.on(event as 'focus', listener)
    events.push([event, listener])
  }
  traced.get(window)?.push(() => { if (!window.isDestroyed()) for (const [event, listener] of events) window.removeListener(event as 'focus', listener) })
}

export function untraceMiniWindow(window: BaseWindow): void {
  if (window.isDestroyed()) return
  untrace(window)
  untrace(window.contentView)
  for (const view of window.contentView.children) untrace(view)
}

/** Trace a header page's own life: (re)loads, crashes, focus. */
export function traceHeaderContents(contents: WebContents, label: () => string): void {
  if (!enabled || contents.isDestroyed() || traced.has(contents)) return
  traced.set(contents, [])
  const events: Array<[string, (...args: unknown[]) => void]> = []
  const on = (event: string, format: (...args: unknown[]) => string): void => {
    const listener = (...args: unknown[]): void => headerDebug('header', `${label()} ${event} ${format(...args)}`)
    contents.on(event as 'focus', listener)
    events.push([event, listener])
  }
  on('did-start-loading', () => '(header page loading: it repaints from scratch)')
  on('did-finish-load', () => '')
  on('render-process-gone', (_event, details) => describe((details as { reason?: string })?.reason))
  on('unresponsive', () => '')
  on('focus', () => '')
  on('blur', () => '')
  wrap(contents, 'reload', label, () => 'header')
  wrap(contents, 'loadURL', label, () => 'header document')
  traced.get(contents)?.push(() => { if (!contents.isDestroyed()) for (const [event, listener] of events) contents.removeListener(event as 'focus', listener) })
}

export function untraceHeaderContents(contents: WebContents): void {
  if (!contents.isDestroyed()) untrace(contents)
}
