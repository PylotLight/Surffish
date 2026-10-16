/**
 * The mini window's header: a slim draggable strip (favicon + title + host, Back, Reload, Tuck to Edge,
 * Return to Browser, Close). It is hidden until the pointer comes near the window's edge
 * (mini-window.ts). Where it shows follows Settings → Mini window header: in a panel of its own just
 * outside the window ('float', body.floating: dragged by pointer events that main follows, since the
 * panel isn't the window), or inside the window over / pushing down the page.
 * With grouping 'tabs' and two or more tabs, a compact tab strip sits under it (favicon, title, close;
 * click to switch, drag a tab out of the window to split it off or onto another mini window to move it)
 * and a Return All button joins the row.
 * Button hints show in place of the title (never as native tooltips, which would cover the tab strip).
 * Tab volume: a speaker shows on a chip (or, with one tab, next to the title) while the tab is
 * audible or muted (shared/tab-audio.ts; muted autoplay video never counts); a quiet tab that was
 * heard shows it only while the chip / header is hovered. Hovering it slides out a volume slider
 * (the title gives way), click mutes, the scroll wheel steps 5%.
 * Menu bar (shared/mini-window-menubar.ts): a Send to Menu Bar button. In the menu bar's popout
 * (body.popout) the header is a different thing: one slim strip, always shown (main never hides it or
 * moves the page under it), holding the tabs (or, with one tab, the favicon and title) and a compact
 * action area: ⋯ (a native menu with Back, Reload, Pin, Float as Mini Window, Move to Edge, Return,
 * Grouping, Settings; arrow keys move through it and Esc closes it, not the popout), Pin (pinned:
 * clicking elsewhere keeps it open) and Close. Right-click on the header opens the mini window's menu
 * (the ⋯ menu in the popout).
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
  #hint { display: none; font-size: 11px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  body.hinting #hint { display: block; }
  body.hinting #text { display: none; }
  body.floating header, body.floating #strip { -webkit-app-region: no-drag; }
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
  #menubar svg, #pin svg { fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }
  body.inmenubar #menubar svg .arrow { transform: rotate(180deg); transform-origin: 8px 10px; }
  #pin.on { color: var(--accent); background: var(--hover); }
  #pin.on svg { fill: currentColor; }
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
  .vol { -webkit-app-region: no-drag; display: none; align-items: center; flex: none; border-radius: 6px; }
  .vol * { -webkit-app-region: no-drag; }
  .vol.shown { display: inline-flex; }
  .vol.idle .spk { color: var(--muted); }
  .tab:hover .vol.idle, .tab:focus-within .vol.idle, header:hover > .vol.idle, header:focus-within > .vol.idle, .vol.idle.open { display: inline-flex; }
  .vol:hover, .vol.open, .vol:focus-within { background: var(--hover); }
  .vol .spk:hover { background: transparent; }
  .vol .spk svg { flex: none; width: 17px; height: 15px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
  .vol .spk .cone { fill: currentColor; }
  .vol.muted .spk { color: var(--muted); }
  .vol input { -webkit-appearance: none; appearance: none; width: 0; height: 16px; margin: 0; padding: 0; opacity: 0; background: transparent; transition: width 140ms ease-out, opacity 140ms ease-out, margin 140ms ease-out; accent-color: var(--accent); }
  .vol:hover input, .vol.open input, .vol:focus-within input { width: 60px; opacity: 1; margin: 0 6px 0 2px; }
  .tab .vol .spk svg { width: 15px; height: 13px; }
  .tab .vol:hover input, .tab .vol.open input, .tab .vol:focus-within input { width: 44px; margin: 0 4px 0 1px; }
  .vol input::-webkit-slider-runnable-track { height: 3px; border-radius: 2px; background: linear-gradient(to right, var(--accent) var(--fill, 100%), var(--line) var(--fill, 100%)); }
  .vol input::-webkit-slider-thumb { -webkit-appearance: none; width: 10px; height: 10px; margin-top: -3.5px; border-radius: 50%; background: var(--text); border: 0; }
  .vol input:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; border-radius: 3px; }
  @media (prefers-reduced-motion: reduce) { .vol input { transition: none; } }
  /* Menu bar popout: one slim strip, always there (no reveal, no motion), tabs and actions in one row. */
  #more { display: none; }
  body.popout header { height: 28px; gap: 1px; padding: 0 3px 0 4px; -webkit-app-region: no-drag; }
  body.popout #back, body.popout #reload, body.popout #tuck, body.popout #menubar, body.popout #return, body.popout #returnAll, body.popout #url, body.popout #progress { display: none; }
  body.popout #more { display: inline-flex; }
  body.popout header > button, body.popout header > .vol > .spk { width: 22px; height: 22px; border-radius: 5px; font-size: 14px; }
  body.popout #where { gap: 6px; padding: 0 3px; }
  body.popout #icon { width: 14px; height: 14px; }
  body.popout #title { font-size: 11.5px; }
  body.popout.tabbed #where { display: none; }
  body.popout #strip { position: static; display: none; flex: 1 1 auto; min-width: 0; height: 100%; padding: 3px 2px 3px 0; border: 0; background: transparent; -webkit-app-region: no-drag; }
  body.popout.tabbed #strip { display: flex; }
  body.popout.loading header { box-shadow: inset 0 -2px 0 -0.5px var(--accent); }
  body.popout #more[aria-expanded=true] { background: var(--hover); }
  @media (prefers-reduced-transparency: reduce) { :root { --bar: rgb(246,246,247); } }
  @media (prefers-reduced-transparency: reduce) and (prefers-color-scheme: dark) { :root { --bar: rgb(38,38,41); } }
</style></head>
<body>
<header id="bar">
  <button id="back" data-hint="Back" aria-label="Back" disabled>&#8249;</button>
  <button id="reload" data-hint="Reload" aria-label="Reload">&#8635;</button>
  <div id="where"><img id="icon" alt="" hidden><div id="text"><div id="title"></div><div id="url"></div></div><div id="hint" aria-hidden="true"></div></div>
  <span id="vol" class="vol"></span>
  <span id="badge">Private</span>
  <button id="tuck" data-hint="Tuck to Edge" aria-label="Tuck to Edge" data-dir="right" hidden><svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M10 3.5 5.5 8l4.5 4.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
  <button id="menubar" data-hint="Send to Menu Bar" aria-label="Send to Menu Bar" hidden><svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><path d="M2 2.5h12"/><path class="arrow" d="M8 13.5v-7M5.2 9.2 8 6.4l2.8 2.8"/></svg></button>
  <button id="more" data-hint="More" aria-label="More" aria-haspopup="menu" aria-expanded="false"><svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><circle cx="3" cy="8" r="1.45" fill="currentColor"/><circle cx="8" cy="8" r="1.45" fill="currentColor"/><circle cx="13" cy="8" r="1.45" fill="currentColor"/></svg></button>
  <button id="pin" data-hint="Pin (stay open when clicking elsewhere)" aria-label="Pin" aria-pressed="false" hidden><svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M6 2h4l-.6 4 2.3 2.3H4.3L6.6 6z"/><path d="M8 8.3v5.2"/></svg></button>
  <button id="return" data-hint="Return to Browser" aria-label="Return to Browser">&#8689;</button>
  <button id="returnAll" data-hint="Return All Tabs to Browser" aria-label="Return All Tabs to Browser">&#8648;</button>
  <button id="close" data-hint="Close" aria-label="Close Mini Window">&#215;</button>
  <div id="progress"></div>
</header>
<nav id="strip" aria-label="Mini window tabs"></nav>
<script>
  const icon = document.getElementById('icon')
  icon.addEventListener('error', () => { icon.hidden = true })
  // Writes only what changed: a rewrite of the same text or attribute still restyles and repaints the
  // header (in the menu bar popout, its glass strip flashed under every keystroke of a busy page).
  function setText(element, value) { const text = String(value ?? ''); if (element.textContent !== text) element.textContent = text }
  function setAttr(element, name, value) { const text = String(value); if (element.getAttribute(name) !== text) element.setAttribute(name, text) }
  function setHint(element, value) { if (element.dataset.hint !== value) element.dataset.hint = value }
  function setHidden(element, hidden) { if (element.hidden !== hidden) element.hidden = hidden }
  window.miniWindow.onState((state) => {
    setText(document.getElementById('title'), state.crashed ? 'Page crashed — Reload' : state.title)
    setText(document.getElementById('url'), state.url)
    const back = document.getElementById('back')
    if (back.disabled !== !state.canGoBack) back.disabled = !state.canGoBack
    document.body.classList.toggle('loading', Boolean(state.loading))
    document.body.classList.toggle('private', Boolean(state.private))
    document.body.classList.toggle('crashed', Boolean(state.crashed))
    document.body.classList.toggle('floating', Boolean(state.floating))
    const tuck = document.getElementById('tuck')
    setHidden(tuck, !state.tuck)
    if (state.tuck) { setAttr(tuck, 'data-dir', state.tuck.arrow); setHint(tuck, state.tuck.label); setAttr(tuck, 'aria-label', state.tuck.label) }
    if (state.faviconUrl && icon.getAttribute('src') !== state.faviconUrl) { icon.hidden = false; icon.src = state.faviconUrl }
    else if (!state.faviconUrl) setHidden(icon, true)
    // Menu bar: Send to Menu Bar (in it: Float as Mini Window) and, in it, Pin.
    const menuBar = state.menuBar || { available: false, inMenuBar: false, pinned: false }
    document.body.classList.toggle('inmenubar', Boolean(menuBar.inMenuBar))
    setPopout(Boolean(menuBar.inMenuBar))
    const menuButton = document.getElementById('menubar')
    setHidden(menuButton, !menuBar.available && !menuBar.inMenuBar)
    const menuLabel = menuBar.inMenuBar ? 'Float as Mini Window' : 'Send to Menu Bar'
    setHint(menuButton, menuLabel)
    setAttr(menuButton, 'aria-label', menuLabel)
    const pin = document.getElementById('pin')
    setHidden(pin, !menuBar.inMenuBar)
    pin.classList.toggle('on', Boolean(menuBar.pinned))
    setAttr(pin, 'aria-pressed', menuBar.pinned ? 'true' : 'false')
    setHint(pin, menuBar.pinned ? 'Pinned (stays open when clicking elsewhere)' : 'Pin (stay open when clicking elsewhere)')
    if (hinted === pin || hinted === menuButton) showHint(hinted)
    const tabs = Array.isArray(state.tabs) ? state.tabs : []
    headerVolume.update({ tabId: state.tabId, audio: tabs.length < 2 ? state.audio : 'none', muted: Boolean(state.muted), volume: state.volume })
    renderTabs(tabs)
  })
  // Tab volume: the speaker (click: mute; wheel: ±5%) and its slider, shown on hover.
  const SPEAKER_WAVES = { muted: '<path d="M15.5 9.5l5 5M20.5 9.5l-5 5"/>', off: '', low: '<path d="M15 9.2a4 4 0 0 1 0 5.6"/>', high: '<path d="M15 9.2a4 4 0 0 1 0 5.6"/><path d="M17.6 6.8a7.4 7.4 0 0 1 0 10.4"/>' }
  let volumeBusy = 0
  function levelOf(volume, muted) { return muted ? 'muted' : volume <= 0.005 ? 'off' : volume < 0.5 ? 'low' : 'high' }
  function clampVolume(value) { const number = Number(value); return Number.isFinite(number) ? Math.round(Math.min(1, Math.max(0, number)) * 100) / 100 : 1 }
  function makeVolume(root, small) {
    root.classList.add('vol')
    const speaker = document.createElement('button')
    speaker.className = 'spk'
    speaker.type = 'button'
    if (small) { speaker.style.width = '18px'; speaker.style.height = '18px' }
    const slider = document.createElement('input')
    slider.type = 'range'
    slider.min = '0'
    slider.max = '100'
    slider.step = '1'
    root.append(speaker, slider)
    const control = { tabId: null, muted: false, volume: 1, level: '', dragging: false, pending: null, frame: 0 }
    function draw() {
      const level = levelOf(control.volume, control.muted)
      if (level !== control.level) {
        control.level = level
        speaker.innerHTML = '<svg viewBox="3 4 19 16" aria-hidden="true"><path class="cone" d="M4.5 9.5h3l4-3.5v12l-4-3.5h-3z"/>' + SPEAKER_WAVES[level] + '</svg>'
      }
      const percent = Math.round(control.volume * 100)
      if (!control.dragging && slider.value !== String(percent)) slider.value = String(percent)
      if (slider.style.getPropertyValue('--fill') !== percent + '%') slider.style.setProperty('--fill', percent + '%')
      root.classList.toggle('muted', control.muted)
      const label = control.muted ? 'Unmute tab (volume ' + percent + '%)' : 'Mute tab (volume ' + percent + '%)'
      setAttr(speaker, 'aria-label', label)
      setHint(speaker, control.muted ? 'Muted · click to unmute' : 'Volume ' + percent + '% · click to mute')
      setAttr(slider, 'aria-label', 'Tab volume')
      setAttr(slider, 'aria-valuetext', percent + '%')
      if (hinted === speaker) showHint(speaker)
    }
    function send(volume) {
      control.volume = clampVolume(volume)
      draw()
      // Until main's state echoes it back, show this value (not a stale one from an earlier update).
      control.pending = control.volume
      clearTimeout(control.frame)
      control.frame = setTimeout(() => { control.pending = null }, 600)
      if (control.tabId) window.miniWindow.setVolume(control.tabId, control.volume)
    }
    speaker.addEventListener('click', (event) => { event.stopPropagation(); if (control.tabId) window.miniWindow.setMuted(control.tabId, !control.muted) })
    for (const type of ['pointerdown', 'mousedown', 'dblclick']) root.addEventListener(type, (event) => event.stopPropagation())
    slider.addEventListener('pointerdown', () => { control.dragging = true; volumeBusy += 1; root.classList.add('open') })
    const endDrag = () => { if (!control.dragging) return; control.dragging = false; volumeBusy = Math.max(0, volumeBusy - 1); root.classList.remove('open'); if (volumeBusy === 0 && deferredTabs) { const tabs = deferredTabs; deferredTabs = null; renderTabs(tabs) } }
    slider.addEventListener('pointerup', endDrag)
    slider.addEventListener('pointercancel', endDrag)
    slider.addEventListener('lostpointercapture', endDrag)
    slider.addEventListener('blur', endDrag)
    slider.addEventListener('input', () => send(Number(slider.value) / 100))
    slider.addEventListener('click', (event) => event.stopPropagation())
    slider.addEventListener('keydown', (event) => event.stopPropagation())
    let wheel = 0
    root.addEventListener('wheel', (event) => {
      event.preventDefault()
      event.stopPropagation()
      // Lines/pages: one step per event; pixels: a mouse notch (~100px) is one step, trackpads add up.
      wheel += event.deltaMode === 0 ? event.deltaY : Math.sign(event.deltaY) * 100
      const steps = Math.trunc(wheel / 100)
      if (steps === 0) return
      wheel -= steps * 100
      send(control.volume - steps * 0.05)
    }, { passive: false })
    if (!small) {
      speaker.addEventListener('mouseenter', () => showHint(speaker))
      speaker.addEventListener('mouseleave', () => hideHint(speaker))
      speaker.addEventListener('focus', () => showHint(speaker))
      speaker.addEventListener('blur', () => hideHint(speaker))
    }
    return {
      root,
      update(state) {
        control.tabId = state.tabId || null
        // 'playing' / 'muted': shown; 'idle': only on hover (CSS); 'none': hidden.
        const audio = control.tabId ? state.audio : 'none'
        root.classList.toggle('shown', audio === 'playing' || audio === 'muted')
        root.classList.toggle('idle', audio === 'idle')
        setAttr(root, 'data-audio', typeof audio === 'string' ? audio : 'none')
        control.muted = Boolean(state.muted)
        const incoming = clampVolume(state.volume)
        if (control.pending !== null && Math.abs(incoming - control.pending) < 0.005) control.pending = null
        if (!control.dragging && control.pending === null) control.volume = incoming
        draw()
      }
    }
  }
  const headerVolume = makeVolume(document.getElementById('vol'), false)
  // The popout's strip: the tab strip moves into the header row (before the speaker and the actions,
  // so Tab goes tabs → ⋯ → Pin → Close); out of the popout it goes back under the header.
  function setPopout(on) {
    if (document.body.classList.contains('popout') === on) return
    document.body.classList.toggle('popout', on)
    const strip = document.getElementById('strip')
    if (on) document.getElementById('bar').insertBefore(strip, document.getElementById('vol'))
    else document.getElementById('bar').after(strip)
    syncPopoutTitles()
  }
  // With tabs in the popout the title's place (where hints show) is gone: the actions get tooltips.
  function syncPopoutTitles() {
    const titled = document.body.classList.contains('popout') && document.body.classList.contains('tabbed')
    for (const id of ['more', 'pin', 'close']) {
      const button = document.getElementById(id)
      if (titled) setAttr(button, 'title', button.dataset.hint || button.getAttribute('aria-label') || '')
      else if (button.hasAttribute('title')) button.removeAttribute('title')
    }
  }
  // The tab strip (grouping 'tabs', two or more tabs).
  const strip = document.getElementById('strip')
  let dragTab = null
  let deferredTabs = null
  let stripKey = ''
  const chipVolumes = new Map()
  function renderTabs(tabs) {
    document.body.classList.toggle('tabbed', tabs.length > 1)
    syncPopoutTitles()
    // With a strip, the header's close button closes the tab on screen (the rest stay).
    const closeButton = document.getElementById('close')
    setHint(closeButton, tabs.length > 1 ? 'Close Tab' : 'Close')
    setAttr(closeButton, 'aria-label', tabs.length > 1 ? 'Close Tab' : 'Close Mini Window')
    if (dragTab) return
    // Only a speaker changed: update the chips in place (keeps a hovered slider open).
    const key = JSON.stringify(tabs.map((tab) => [tab.tabId, tab.title, tab.faviconUrl, tab.active]))
    if (key === stripKey) {
      for (const tab of tabs) chipVolumes.get(tab.tabId)?.update(tab)
      return
    }
    // Never rebuild under a slider being dragged.
    if (volumeBusy > 0) { deferredTabs = tabs; return }
    stripKey = key
    chipVolumes.clear()
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
      const volume = makeVolume(document.createElement('span'), true)
      volume.update(tab)
      chipVolumes.set(tab.tabId, volume)
      item.append(label, volume.root, close)
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
  // Button hints: shown in the title's place (a native tooltip would drop over the tab strip).
  const hint = document.getElementById('hint')
  let hinted = null
  function showHint(button) {
    hinted = button
    setText(hint, button.dataset.hint || button.getAttribute('aria-label') || '')
    document.body.classList.toggle('hinting', Boolean(hint.textContent))
  }
  function hideHint(button) {
    if (hinted !== button) return
    hinted = null
    document.body.classList.remove('hinting')
  }
  for (const button of document.querySelectorAll('header > button')) {
    button.addEventListener('mouseenter', () => showHint(button))
    button.addEventListener('mouseleave', () => hideHint(button))
    button.addEventListener('focus', () => showHint(button))
    button.addEventListener('blur', () => hideHint(button))
  }
  const bar = document.getElementById('bar')
  // Floating (a panel outside the window): pressing the header or strip background drags the window;
  // main follows the pointer until it is let go.
  let dragging = null
  function startDrag(event) {
    if (!document.body.classList.contains('floating') || event.button !== 0 || dragging !== null) return
    if (event.target.closest('button, .tab, .vol')) return
    dragging = { id: event.pointerId, target: event.currentTarget }
    event.currentTarget.setPointerCapture(event.pointerId)
    window.miniWindow.dragHeader(true)
  }
  function endDrag(event) {
    if (!dragging || dragging.id !== event.pointerId) return
    const target = dragging.target
    dragging = null
    if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId)
    window.miniWindow.dragHeader(false)
  }
  for (const surface of [bar, strip]) {
    surface.addEventListener('pointerdown', startDrag)
    surface.addEventListener('pointerup', endDrag)
    surface.addEventListener('pointercancel', endDrag)
    surface.addEventListener('lostpointercapture', endDrag)
  }
  window.addEventListener('blur', () => { if (dragging) { dragging = null; window.miniWindow.dragHeader(false) } })
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
  document.getElementById('menubar').addEventListener('click', () => window.miniWindow.menuBar())
  document.getElementById('pin').addEventListener('click', () => window.miniWindow.pin())
  // ⋯ (popout): a native menu under the button. Enter/Space/click or ArrowDown open it.
  const more = document.getElementById('more')
  function openMore() {
    const rect = more.getBoundingClientRect()
    more.setAttribute('aria-expanded', 'true')
    window.miniWindow.more(rect.left, rect.bottom + 2)
  }
  more.addEventListener('click', openMore)
  more.addEventListener('keydown', (event) => { if (event.key === 'ArrowDown') { event.preventDefault(); openMore() } })
  window.miniWindow.onMenuClosed(() => { more.setAttribute('aria-expanded', 'false') })
  // Right-click on the header (not a tab chip or the volume): the mini window's menu.
  // (In the popout the strip sits inside the header row: one menu per right-click.)
  for (const surface of [bar, strip]) surface.addEventListener('contextmenu', (event) => { if (event.target.closest('.tab, .vol')) return; event.preventDefault(); event.stopPropagation(); window.miniWindow.menu() })
</script>
</body></html>`
