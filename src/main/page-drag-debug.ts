import type { WebContents } from 'electron'

/**
 * SURFFISH_DEBUG_DRAG=1: log how each drag out of a page tab went, to stderr, so a drag that never
 * shows a drag image on macOS can be pinned to a stage in one try:
 *
 *   press on selection → no dragstart        Blink never started the drag (mouse moves didn't reach
 *                                             the page, or the page is still stuck in an earlier drag)
 *   dragstart → dragend within ~50 ms         the browser refused the drag and told the page right away
 *   dragstart → dragend when you let go       the native drag session ran (the drop side is the problem)
 *   dragstart → no dragend                    the browser dropped the drag without telling the page;
 *                                             every later drag from this tab is refused until reload
 *
 * Runs in an isolated world (the page can't see or cancel it). Off unless the variable is set.
 */
const enabled = /^(1|on|true|yes)$/i.test(process.env.SURFFISH_DEBUG_DRAG?.trim() ?? '')
const PREFIX = '[surffish-drag]'
const WORLD_ID = 1847

const PAGE_SCRIPT = `(() => {
  if (window.__surffishDragDebug) return
  window.__surffishDragDebug = true
  const log = (line) => console.debug(${JSON.stringify(PREFIX)} + ' ' + line)
  let started = 0
  let pending = null
  const where = (event) => Math.round(event.clientX) + ',' + Math.round(event.clientY)
  window.addEventListener('mousedown', (event) => {
    if (event.button !== 0) return
    const selection = getSelection()
    let onSelection = false
    try {
      for (let i = 0; i < selection.rangeCount && !onSelection; i++) {
        for (const rect of selection.getRangeAt(i).getClientRects()) {
          if (event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom) { onSelection = true; break }
        }
      }
    } catch {}
    log('mousedown at ' + where(event) + ' clicks=' + event.detail + (onSelection ? ' on the selection' : '') + (event.defaultPrevented ? ' (page cancelled it)' : ''))
  }, true)
  window.addEventListener('dragstart', (event) => {
    started = performance.now()
    clearTimeout(pending)
    pending = setTimeout(() => log('no dragend 10 s after dragstart: the browser dropped the drag without ending it'), 10000)
    const types = event.dataTransfer ? [...event.dataTransfer.types].join(',') : 'none'
    setTimeout(() => log('dragstart at ' + where(event) + ' types=' + types + (event.defaultPrevented ? ' (page cancelled it)' : '')), 0)
  }, true)
  window.addEventListener('dragend', (event) => {
    clearTimeout(pending)
    const ms = started ? Math.round(performance.now() - started) : -1
    log('dragend after ' + ms + ' ms dropEffect=' + (event.dataTransfer ? event.dataTransfer.dropEffect : 'none'))
    started = 0
  }, true)
  window.addEventListener('drop', (event) => {
    setTimeout(() => log('drop at ' + where(event) + (event.defaultPrevented ? ' (handled by the page)' : '')), 0)
  }, true)
})()`

export function debugPageDrags(contents: WebContents): void {
  if (!enabled) return
  contents.on('console-message', (...args: unknown[]) => {
    // Electron 35+: (event) with the details on the event; older: (event, level, message, ...).
    const first = args[0] as { message?: unknown } | undefined
    const message = typeof first?.message === 'string' ? first.message : typeof args[2] === 'string' ? args[2] : ''
    if (message.startsWith(PREFIX)) console.log(`${message} (tab ${contents.id} ${contents.getURL().slice(0, 80)})`)
  })
  contents.on('dom-ready', () => {
    if (contents.isDestroyed()) return
    void contents.executeJavaScriptInIsolatedWorld(WORLD_ID, [{ code: PAGE_SCRIPT }]).catch(() => undefined)
  })
}
