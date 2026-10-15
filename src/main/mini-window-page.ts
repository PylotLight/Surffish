/**
 * The mini window's header: a slim draggable strip over the top of the page (favicon + title + host,
 * Back, Reload, Tuck to Edge, Return to Browser, Close). It is collapsed to nothing until the pointer comes near
 * the top of the window (mini-window.ts resizes the view), so the page gets the whole window.
 * With grouping 'tabs' and two or more tabs, a compact tab strip sits under it (favicon, title, close;
 * click to switch, drag a tab out of the window to split it off or onto another mini window to move it)
 * and a Return All button joins the row.
 * Loaded from a data: URL with the narrow preload in preload/mini-window.cjs; never remote content.
 */
export const MINI_WINDOW_PAGE_HTML = `<!doctype html>
<html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src https: http: data:">
<title>Mini Window</title>
<style>
  :root { color-scheme: light dark; --bar: rgba(246,246,247,.94); --text: #1d1d1f; --muted: #6e6e73; --line: rgba(0,0,0,.1); --hover: rgba(0,0,0,.08); --accent: #2f6fed; }
  @media (prefers-color-scheme: dark) { :root { --bar: rgba(38,38,41,.94); --text: #f2f2f4; --muted: #a1a1a6; --line: rgba(255,255,255,.1); --hover: rgba(255,255,255,.1); --accent: #6d9bff; } }
  html, body { margin: 0; height: 100%; overflow: hidden; background: transparent; font: 12px/1.25 system-ui, -apple-system, "Segoe UI", sans-serif; color: var(--text); user-select: none; }
  header { position: fixed; left: 0; right: 0; top: 0; height: 36px; display: flex; align-items: center; gap: 2px; padding: 0 6px; box-sizing: border-box; background: var(--bar); border-bottom: 1px solid var(--line); -webkit-app-region: drag; }
  #where { flex: 1; min-width: 0; display: flex; align-items: center; gap: 7px; padding: 0 4px; }
  #icon { width: 16px; height: 16px; border-radius: 3px; flex: none; }
  #icon[hidden] { display: none; }
  #text { min-width: 0; display: flex; flex-direction: column; }
  #title { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  #url { font-size: 11px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  #badge { display: none; font-size: 11px; color: var(--muted); border: 1px solid var(--line); border-radius: 999px; padding: 0 6px; flex: none; }
  body.private #badge { display: inline-block; }
  button { -webkit-app-region: no-drag; appearance: none; border: 0; background: transparent; color: var(--text); font: inherit; width: 26px; height: 26px; border-radius: 6px; display: inline-flex; align-items: center; justify-content: center; font-size: 15px; cursor: default; flex: none; }
  button:hover { background: var(--hover); }
  button:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
  button[disabled] { opacity: .35; }
  button[hidden] { display: none; }
  #tuck[data-dir=right] svg { transform: rotate(180deg); }
  #tuck[data-dir=up] svg { transform: rotate(90deg); }
  #tuck[data-dir=down] svg { transform: rotate(-90deg); }
  #progress { position: absolute; left: 0; bottom: -1px; height: 2px; width: 0; background: var(--accent); opacity: 0; transition: width 400ms ease-out, opacity 200ms; }
  body.loading #progress { width: 70%; opacity: 1; }
  body.crashed #title { color: #d33; }
  #returnAll { display: none; }
  body.tabbed #returnAll { display: inline-flex; }
  #strip { position: fixed; left: 0; right: 0; top: 36px; height: 28px; display: none; align-items: stretch; gap: 2px; padding: 3px 6px; box-sizing: border-box; background: var(--bar); border-bottom: 1px solid var(--line); -webkit-app-region: drag; overflow: hidden; }
  body.tabbed #strip { display: flex; }
  .tab { -webkit-app-region: no-drag; flex: 1 1 0; min-width: 0; max-width: 180px; display: flex; align-items: center; gap: 5px; padding: 0 2px 0 7px; border-radius: 6px; color: var(--muted); font-size: 11px; cursor: default; }
  .tab:hover { background: var(--hover); }
  .tab.active { background: var(--hover); color: var(--text); font-weight: 600; }
  .tab:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
  .tab.dragging { opacity: .55; }
  .tab img { width: 14px; height: 14px; border-radius: 3px; flex: none; }
  .tab .label { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .tab button { width: 18px; height: 18px; font-size: 13px; border-radius: 4px; }
</style></head>
<body>
<header id="bar">
  <button id="back" title="Back" aria-label="Back" disabled>&#8249;</button>
  <button id="reload" title="Reload" aria-label="Reload">&#8635;</button>
  <div id="where"><img id="icon" alt="" hidden><div id="text"><div id="title"></div><div id="url"></div></div></div>
  <span id="badge">Private</span>
  <button id="tuck" title="Tuck to Edge" aria-label="Tuck to Edge" data-dir="right" hidden><svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M10 3.5 5.5 8l4.5 4.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
  <button id="return" title="Return to Browser" aria-label="Return to Browser">&#8689;</button>
  <button id="returnAll" title="Return All Tabs to Browser" aria-label="Return All Tabs to Browser">&#8648;</button>
  <button id="close" title="Close" aria-label="Close Mini Window">&#215;</button>
  <div id="progress"></div>
</header>
<nav id="strip" aria-label="Mini window tabs"></nav>
<script>
  const icon = document.getElementById('icon')
  icon.addEventListener('error', () => { icon.hidden = true })
  window.miniWindow.onState((state) => {
    document.getElementById('title').textContent = state.crashed ? 'Page crashed — Reload' : state.title
    document.getElementById('url').textContent = state.url
    document.getElementById('back').disabled = !state.canGoBack
    document.body.classList.toggle('loading', Boolean(state.loading))
    document.body.classList.toggle('private', Boolean(state.private))
    document.body.classList.toggle('crashed', Boolean(state.crashed))
    const tuck = document.getElementById('tuck')
    tuck.hidden = !state.tuck
    if (state.tuck) { tuck.dataset.dir = state.tuck.arrow; tuck.title = state.tuck.label; tuck.setAttribute('aria-label', state.tuck.label) }
    if (state.faviconUrl && icon.getAttribute('src') !== state.faviconUrl) { icon.hidden = false; icon.src = state.faviconUrl }
    else if (!state.faviconUrl) icon.hidden = true
    renderTabs(Array.isArray(state.tabs) ? state.tabs : [])
  })
  // The tab strip (grouping 'tabs', two or more tabs).
  const strip = document.getElementById('strip')
  let dragTab = null
  function renderTabs(tabs) {
    document.body.classList.toggle('tabbed', tabs.length > 1)
    // With a strip, the header's close button closes the tab on screen (the rest stay).
    const closeButton = document.getElementById('close')
    closeButton.title = tabs.length > 1 ? 'Close Tab' : 'Close'
    closeButton.setAttribute('aria-label', tabs.length > 1 ? 'Close Tab' : 'Close Mini Window')
    if (dragTab) return
    strip.replaceChildren(...tabs.map((tab) => {
      const item = document.createElement('div')
      item.className = 'tab' + (tab.active ? ' active' : '')
      item.dataset.tabId = tab.tabId
      item.setAttribute('role', 'tab')
      item.setAttribute('aria-selected', tab.active ? 'true' : 'false')
      item.tabIndex = 0
      item.title = tab.title + ' (drag out of the window to split it off)'
      if (tab.faviconUrl) {
        const img = document.createElement('img')
        img.alt = ''
        img.src = tab.faviconUrl
        img.addEventListener('error', () => img.remove())
        item.append(img)
      }
      const label = document.createElement('span')
      label.className = 'label'
      label.textContent = tab.title
      const close = document.createElement('button')
      close.innerHTML = '&#215;'
      close.title = 'Close Tab'
      close.setAttribute('aria-label', 'Close ' + tab.title)
      close.addEventListener('pointerdown', (event) => event.stopPropagation())
      close.addEventListener('click', (event) => { event.stopPropagation(); window.miniWindow.closeTab(tab.tabId) })
      item.append(label, close)
      item.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); window.miniWindow.activateTab(tab.tabId) } })
      // Click: switch. Press and drag out of the window: split off (or onto another mini window: move there).
      item.addEventListener('pointerdown', (event) => {
        if (event.button !== 0) return
        dragTab = { id: tab.tabId, item, x: event.screenX, y: event.screenY, moved: false }
        item.setPointerCapture(event.pointerId)
      })
      item.addEventListener('pointermove', (event) => {
        if (!dragTab || dragTab.item !== item) return
        if (!dragTab.moved && Math.abs(event.screenX - dragTab.x) + Math.abs(event.screenY - dragTab.y) < 6) return
        dragTab.moved = true
        item.classList.add('dragging')
      })
      const release = (event, done) => {
        if (!dragTab || dragTab.item !== item) return
        const drag = dragTab
        dragTab = null
        item.classList.remove('dragging')
        if (!done) return
        if (!drag.moved) return window.miniWindow.activateTab(drag.id)
        // Let go outside the header: main decides (split off / move into the window under the pointer).
        const outside = event.clientY < 0 || event.clientY > window.innerHeight || event.clientX < 0 || event.clientX > window.innerWidth
        if (outside) window.miniWindow.tabOut(drag.id, event.screenX, event.screenY)
      }
      item.addEventListener('pointerup', (event) => release(event, true))
      item.addEventListener('pointercancel', (event) => release(event, false))
      return item
    }))
  }
  const bar = document.getElementById('bar')
  bar.addEventListener('mouseenter', () => window.miniWindow.hover(true))
  bar.addEventListener('mouseleave', () => window.miniWindow.hover(false))
  strip.addEventListener('mouseenter', () => window.miniWindow.hover(true))
  strip.addEventListener('mouseleave', () => window.miniWindow.hover(false))
  document.getElementById('back').addEventListener('click', () => window.miniWindow.back())
  document.getElementById('reload').addEventListener('click', () => window.miniWindow.reload())
  document.getElementById('tuck').addEventListener('click', () => window.miniWindow.tuck())
  document.getElementById('return').addEventListener('click', () => window.miniWindow.returnToBrowser())
  document.getElementById('returnAll').addEventListener('click', () => window.miniWindow.returnAll())
  document.getElementById('close').addEventListener('click', () => window.miniWindow.close())
</script>
</body></html>`
