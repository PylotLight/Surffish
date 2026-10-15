/**
 * The mini window's dock handle: a small half-round tab on a screen edge (tucked) or on the docked
 * window's free side (out). Click slides the window out / tucks it; drag moves it along the edge.
 * Loaded from a data: URL in its own tiny always-on-top window with the narrow preload in
 * preload/mini-window.cjs; never remote content. main/mini-window-dock.ts sends it the edge, the
 * arrow and the page's favicon.
 */
export const MINI_WINDOW_HANDLE_HTML = `<!doctype html>
<html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src https: http: data:">
<title>Mini Window Handle</title>
<style>
  :root { color-scheme: light dark; --tab: rgba(246,246,247,.97); --text: #1d1d1f; --line: rgba(0,0,0,.24); --hover: #ffffff; --accent: #2f6fed; }
  @media (prefers-color-scheme: dark) { :root { --tab: rgba(44,44,48,.97); --text: #f2f2f4; --line: rgba(255,255,255,.22); --hover: #3a3a3f; --accent: #6d9bff; } }
  html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; background: transparent; user-select: none; }
  #tab { position: absolute; inset: 0; box-sizing: border-box; display: flex; align-items: center; justify-content: center; gap: 3px;
    background: var(--tab); color: var(--text); border: 1px solid var(--line); font: 600 15px/1 system-ui, -apple-system, "Segoe UI", sans-serif; cursor: default;
    transition: background-color 120ms; }
  #tab:hover { background: var(--hover); }
  #tab:focus-visible { outline: 2px solid var(--accent); outline-offset: -3px; }
  /* Rounded on the side away from the edge it hangs off (body class = the dock edge). */
  body.left #tab, body.right #tab { flex-direction: column; }
  body.left #tab { border-left: 0; border-radius: 0 999px 999px 0; }
  body.right #tab { border-right: 0; border-radius: 999px 0 0 999px; }
  body.top #tab { border-top: 0; border-radius: 0 0 999px 999px; }
  body.bottom #tab { border-bottom: 0; border-radius: 999px 999px 0 0; }
  body.dragging #tab { cursor: grabbing; }
  #icon { width: 12px; height: 12px; border-radius: 2px; flex: none; pointer-events: none; }
  #icon[hidden] { display: none; }
  #arrow { pointer-events: none; display: flex; }
  #arrow[data-dir=right] svg { transform: rotate(180deg); }
  #arrow[data-dir=up] svg { transform: rotate(90deg); }
  #arrow[data-dir=down] svg { transform: rotate(-90deg); }
  @media (prefers-reduced-motion: reduce) { #tab { transition: none; } }
</style></head>
<body class="right">
<div id="tab" role="button" tabindex="-1" aria-label="Show Mini Window" title="Show Mini Window (drag to move along the edge)"><img id="icon" alt="" hidden><span id="arrow" data-dir="left"><svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M10 3.5 5.5 8l4.5 4.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></span></div>
<script>
  const tab = document.getElementById('tab')
  const icon = document.getElementById('icon')
  icon.addEventListener('error', () => { icon.hidden = true })
  window.miniWindow.onHandleState((state) => {
    document.body.className = state.edge
    document.getElementById('arrow').dataset.dir = state.arrow
    tab.setAttribute('aria-label', state.label)
    tab.title = state.label + ' (drag to move along the edge)'
    if (state.faviconUrl && icon.getAttribute('src') !== state.faviconUrl) { icon.hidden = false; icon.src = state.faviconUrl }
    else if (!state.faviconUrl) icon.hidden = true
  })
  // Click: slide out / tuck. Press and move: drag along the edge (main follows the pointer).
  let down = null
  let dragging = false
  tab.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return
    down = { x: event.screenX, y: event.screenY }
    dragging = false
    tab.setPointerCapture(event.pointerId)
  })
  tab.addEventListener('pointermove', (event) => {
    if (!down || dragging) return
    if (Math.abs(event.screenX - down.x) + Math.abs(event.screenY - down.y) < 4) return
    dragging = true
    document.body.classList.add('dragging')
    window.miniWindow.handleDrag(true)
  })
  const release = (click) => {
    if (!down) return
    down = null
    if (dragging) { dragging = false; document.body.classList.remove('dragging'); window.miniWindow.handleDrag(false) }
    else if (click) window.miniWindow.handleClick()
  }
  tab.addEventListener('pointerup', () => release(true))
  tab.addEventListener('pointercancel', () => release(false))
  tab.addEventListener('lostpointercapture', () => release(false))
  tab.addEventListener('pointerenter', () => window.miniWindow.handleHover(true))
  tab.addEventListener('pointerleave', () => window.miniWindow.handleHover(false))
</script>
</body></html>`
