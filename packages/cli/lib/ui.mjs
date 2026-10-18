// Terminal output. Two modes:
//  - interactive (a TTY, not CI, TERM isn't dumb): a one-line progress bar with a rotating
//    "what's happening / did you know" line under it, spinners for verify/unpack, colour unless NO_COLOR.
//  - plain (piped, CI, NO_COLOR alone only drops colour): ordinary log lines, progress every 10%,
//    never an ANSI escape.
import { formatBytes, formatDuration } from './core.mjs'

const ESC = '\x1b['
const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

/**
 * @param {{ isTTY?: boolean, columns?: number }} stream
 * @param {Record<string, string | undefined>} env
 */
export function detectMode(stream, env = process.env) {
  const interactive = Boolean(stream.isTTY) && !env.CI && env.TERM !== 'dumb'
  const color = interactive && env.NO_COLOR === undefined
  return { interactive, color }
}

/** Interleaves the process explainers with the tips: e0, t0, e1, t1, ... then the rest. */
export function rotationLines(explainers, tips) {
  const out = []
  for (let i = 0; i < Math.max(explainers.length, tips.length); i++) {
    if (i < explainers.length) out.push(explainers[i])
    if (i < tips.length) out.push(tips[i])
  }
  return out
}

/** The bar line text (no colour codes). Exported for tests. */
export function progressLine({ received, total, elapsedMs, width = 80 }) {
  const secs = Math.max(elapsedMs / 1000, 0.001)
  const speed = received / secs
  const known = Number.isFinite(total) && total > 0
  const pct = known ? Math.min(100, Math.floor((received / total) * 100)) : null
  const eta = known && speed > 0 ? (total - received) / speed : NaN
  const stats = known
    ? `${String(pct).padStart(3)}%  ${formatBytes(received)} / ${formatBytes(total)}  ${formatBytes(speed)}/s  ETA ${formatDuration(eta)}`
    : `${formatBytes(received)}  ${formatBytes(speed)}/s`
  const barWidth = Math.max(10, Math.min(30, width - stats.length - 6))
  const filled = known ? Math.round((barWidth * (pct ?? 0)) / 100) : 0
  const bar = known ? '█'.repeat(filled) + '░'.repeat(barWidth - filled) : '░'.repeat(barWidth)
  return { bar, stats, pct }
}

/**
 * @param {{ stream?: NodeJS.WriteStream | { write(s: string): unknown, isTTY?: boolean, columns?: number }, env?: Record<string, string | undefined>, now?: () => number, rotateMs?: number }} [opts]
 */
export function createUI({ stream = process.stderr, env = process.env, now = Date.now, rotateMs = 2000 } = {}) {
  const { interactive, color } = detectMode(stream, env)
  const paint = (code, s) => (color ? `${ESC}${code}m${s}${ESC}0m` : s)
  const c = {
    dim: (s) => paint('2', s),
    bold: (s) => paint('1', s),
    green: (s) => paint('32', s),
    cyan: (s) => paint('36', s),
    yellow: (s) => paint('33', s),
    red: (s) => paint('31', s),
  }
  const width = () => Math.max(40, Math.min(stream.columns || 80, 120))
  const clip = (s, max = width() - 2) => (s.length > max ? s.slice(0, max - 1) + '…' : s)
  const write = (s) => stream.write(s)

  let liveLines = 0 // lines currently drawn by a live region (cursor sits on its first line)
  let cursorHidden = false
  /** @type {ReturnType<typeof setInterval> | null} */
  let timer = null

  function hideCursor() {
    if (interactive && !cursorHidden) { write(`${ESC}?25l`); cursorHidden = true }
  }
  function clearLive() {
    if (!interactive || liveLines === 0) return
    let s = `\r${ESC}2K`
    for (let i = 1; i < liveLines; i++) s += `\n${ESC}2K`
    for (let i = 1; i < liveLines; i++) s += `${ESC}1A`
    write(s + '\r')
    liveLines = 0
  }
  function drawLive(lines) {
    hideCursor()
    let s = ''
    lines.forEach((line, i) => { s += `${i ? '\n' : '\r'}${ESC}2K${line}` })
    // back to the first line so the next draw overwrites in place
    for (let i = 1; i < lines.length; i++) s += `${ESC}1A`
    write(s + '\r')
    liveLines = lines.length
  }
  function stopTimer() {
    if (timer) { clearInterval(timer); timer = null }
  }

  const ui = {
    interactive,
    color,
    c,
    /** A normal line (clears any live region first). */
    line(text = '') {
      clearLive()
      write(text + '\n')
    },
    info(text) { ui.line(interactive ? `  ${c.dim(text)}` : text) },
    header(text) { ui.line(interactive ? `${c.cyan('◆')} ${c.bold(text)}` : text) },
    step(text) { ui.line(interactive ? `  ${c.green('✓')} ${text}` : `ok: ${text}`) },
    next(text) { ui.line(interactive ? `  ${c.cyan('→')} ${text}` : `-> ${text}`) },
    warn(text) { ui.line(interactive ? `  ${c.yellow('!')} ${text}` : `warning: ${text}`) },
    error(text) { ui.line(interactive ? `${c.red('✗')} ${text}` : `error: ${text}`) },

    /**
     * Download progress. Call update(received, total) as bytes arrive, done() at the end.
     * @param {{ rotation: string[], label: string }} opts
     */
    progress({ rotation, label }) {
      const started = now()
      let received = 0
      let total = NaN
      let lastDraw = 0
      let lastPlainPct = 0
      let rot = 0
      const draw = () => {
        const { bar, stats } = progressLine({ received, total, elapsedMs: now() - started, width: width() - 2 })
        const tip = rotation.length ? rotation[rot % rotation.length] : ''
        drawLive([`  ${c.cyan(bar)} ${stats}`, tip ? `  ${c.dim(clip('› ' + tip, width() - 4))}` : ''])
      }
      if (interactive) {
        draw()
        timer = setInterval(() => { rot++; draw() }, rotateMs)
        timer.unref?.()
      } else {
        ui.line(label)
      }
      return {
        update(bytes, totalBytes) {
          received = bytes
          if (Number.isFinite(totalBytes) && totalBytes > 0) total = totalBytes
          if (interactive) {
            const t = now()
            if (t - lastDraw >= 80) { lastDraw = t; draw() }
          } else if (Number.isFinite(total)) {
            const pct = Math.floor((received / total) * 100)
            if (pct >= lastPlainPct + 10) {
              lastPlainPct = pct - (pct % 10)
              ui.line(`download ${lastPlainPct}% (${formatBytes(received)} / ${formatBytes(total)})`)
            }
          }
        },
        /** @returns {{ elapsedMs: number, received: number }} */
        done() {
          stopTimer()
          clearLive()
          return { elapsedMs: now() - started, received }
        },
      }
    },

    /** A spinner line for a short task; returns stop(). Plain mode prints the label once. */
    spinner(label) {
      if (!interactive) { ui.line(`${label}...`); return () => {} }
      let i = 0
      const draw = () => drawLive([`  ${c.cyan(SPINNER[i++ % SPINNER.length] ?? '')} ${label}`])
      draw()
      const t = setInterval(draw, 80)
      t.unref?.()
      return () => { clearInterval(t); clearLive() }
    },

    /** Put the terminal back (cursor, live region). Safe to call more than once. */
    restore() {
      stopTimer()
      clearLive()
      if (cursorHidden) { write(`${ESC}?25h`); cursorHidden = false }
    },
  }
  return ui
}
