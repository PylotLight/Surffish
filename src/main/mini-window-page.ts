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
 * New Tab (+ in the header row, or after the last strip chip; ⌘/Ctrl+T) and the address field: on a
 * New Tab it shows in the title's place by itself, focused; ⌘/Ctrl+L shows it on any page, Esc hides it.
 * Main runs the toolbar omnibox's model for it (shared/mini-window-omnibox.ts) and says what it shows,
 * its suggestions included; the dropdown hangs under the header (main makes the view taller for it).
 * Loaded from a data: URL with the narrow preload in preload/mini-window.cjs; never remote content.
 */
export const MINI_WINDOW_PAGE_HTML = `<!doctype html>
<html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src https: http: data:">
<title>Mini Window</title>
<style>
  /* The bar is opaque on purpose: the window is transparent, so any see-through bar shows whatever macOS composites behind it, which flips between the desktop and black while the page view below repaints (a visible flash). */
  :root { color-scheme: light dark; --bar: rgb(246,246,247); --text: #1d1d1f; --muted: #6e6e73; --line: rgba(0,0,0,.1); --hover: rgba(0,0,0,.08); --accent: #2f6fed; --field: #fff; }
  @media (prefers-color-scheme: dark) { :root { --bar: rgb(38,38,41); --text: #f2f2f4; --muted: #a1a1a6; --line: rgba(255,255,255,.1); --hover: rgba(255,255,255,.1); --accent: #6d9bff; --field: rgb(28,28,30); } }
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
  body.chip-dragging, body.chip-dragging * { cursor: grabbing !important; }
  #caret { position: fixed; width: 2px; border-radius: 1px; background: var(--accent); pointer-events: none; display: none; z-index: 5; }
  #caret.on { display: block; }
  body.drop-target #strip, body.drop-target header { box-shadow: inset 0 0 0 1px var(--accent); }
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
  /* New Tab: + in the header row (no strip) or right after the last chip (strip). */
  #plus { font-size: 17px; }
  body.tabbed #plus { display: none; }
  .strip-plus { -webkit-app-region: no-drag; flex: none; align-self: center; width: 22px; height: 22px; font-size: 15px; border-radius: 6px; color: var(--muted); }
  .strip-plus:hover { color: var(--text); }
  /* The address field (in the title's place) and its suggestions under the header. */
  #addr { display: none; flex: 1; min-width: 0; align-items: center; padding: 0 2px; margin: 0; }
  body.addressing #addr { display: flex; }
  body.addressing #where { display: none; }
  #addrInput { -webkit-app-region: no-drag; flex: 1; min-width: 0; height: 24px; box-sizing: border-box; margin: 0; padding: 0 8px; border: 1px solid var(--line); border-radius: 6px; background: var(--field); color: var(--text); font: 12px system-ui, -apple-system, "Segoe UI", sans-serif; outline: none; user-select: text; }
  #addrInput:focus { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
  #addrInput::placeholder { color: var(--muted); }
  #drop { position: fixed; left: 4px; right: 4px; top: 36px; display: none; box-sizing: border-box; padding: 4px 0; background: var(--bar); border: 1px solid var(--line); border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,.18); overflow: hidden; z-index: 6; }
  body.addressing #drop.on { display: block; }
  .row { height: 40px; box-sizing: border-box; display: flex; align-items: center; gap: 8px; padding: 0 10px; cursor: default; }
  .row:hover, .row.sel { background: var(--hover); }
  .row .main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
  .row .t { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .row .u { font-size: 11px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .row .u .host { color: var(--text); }
  .row .m { color: var(--accent); }
  .row .src, .row .chip { flex: none; font-size: 10.5px; color: var(--muted); }
  .row .chip { border: 1px solid var(--line); border-radius: 999px; padding: 0 6px; }
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
  body.popout.addressing #strip { display: none; }
  body.popout #addrInput { height: 20px; font-size: 11.5px; }
  body.popout #plus { width: 22px; height: 22px; font-size: 15px; }
  @media (prefers-reduced-transparency: reduce) { :root { --bar: rgb(246,246,247); } }
  @media (prefers-reduced-transparency: reduce) and (prefers-color-scheme: dark) { :root { --bar: rgb(38,38,41); } }
</style></head>
<body>
<header id="bar">
  <button id="back" data-hint="Back" aria-label="Back" disabled>&#8249;</button>
  <button id="reload" data-hint="Reload" aria-label="Reload">&#8635;</button>
  <div id="where"><img id="icon" alt="" hidden><div id="text"><div id="title"></div><div id="url"></div></div><div id="hint" aria-hidden="true"></div></div>
  <form id="addr" autocomplete="off"><input id="addrInput" type="text" role="combobox" aria-label="Search or enter address" aria-autocomplete="list" aria-controls="drop" aria-expanded="false" placeholder="Search or enter address" spellcheck="false" autocapitalize="none"></form>
  <button id="plus" data-hint="New Tab" aria-label="New Tab">+</button>
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
<div id="drop" role="listbox" aria-label="Address suggestions"></div>
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
    const plus = document.getElementById('plus')
    const canNewTab = state.canNewTab !== false
    if (plus.disabled !== !canNewTab) plus.disabled = !canNewTab
    if (stripPlus.disabled !== !canNewTab) stripPlus.disabled = !canNewTab
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
  // + right after the last chip (it stays the strip's last child; chips are the .tab children).
  const stripPlus = document.createElement('button')
  stripPlus.id = 'stripPlus'
  stripPlus.className = 'strip-plus'
  stripPlus.type = 'button'
  stripPlus.innerHTML = '+'
  stripPlus.title = 'New Tab'
  stripPlus.setAttribute('aria-label', 'New Tab')
  stripPlus.addEventListener('pointerdown', (event) => event.stopPropagation())
  stripPlus.addEventListener('click', (event) => { event.stopPropagation(); window.miniWindow.newTab() })
  strip.append(stripPlus)
  let dragTab = null
  let draggedTabs = null
  // Where the chips are (header coordinates), for main's drop slots; reported when it changes.
  let layoutKey = ''
  function reportStripLayout() {
    const shown = document.body.classList.contains('tabbed')
    const r = strip.getBoundingClientRect()
    const chips = shown ? [...strip.querySelectorAll('.tab')].map((el) => { const c = el.getBoundingClientRect(); return { id: el.dataset.tabId, left: Math.round(c.left), width: Math.round(c.width) } }) : []
    const layout = { strip: { x: Math.round(r.left), y: Math.round(r.top), width: shown ? Math.round(r.width) : 0, height: shown ? Math.round(r.height) : 0 }, chips }
    const key = JSON.stringify(layout)
    if (key === layoutKey) return
    layoutKey = key
    window.miniWindow.stripLayout(layout)
  }
  new ResizeObserver(() => reportStripLayout()).observe(strip)
  window.addEventListener('resize', () => reportStripLayout())
  // The insertion caret: where a dragged chip (this strip's, or a tab from elsewhere) lands.
  const caret = document.createElement('div')
  caret.id = 'caret'
  document.body.append(caret)
  function chipSlot(x) {
    const chips = [...strip.querySelectorAll('.tab')]
    for (const [index, el] of chips.entries()) { const r = el.getBoundingClientRect(); if (x < r.left + r.width / 2) return index }
    return chips.length
  }
  function showCaret(slot) {
    const chips = [...strip.querySelectorAll('.tab')]
    if (slot === null || slot === undefined || chips.length === 0 || !document.body.classList.contains('tabbed')) { caret.classList.remove('on'); return }
    const s = strip.getBoundingClientRect()
    const at = chips[slot] ? chips[slot].getBoundingClientRect().left - 2 : chips[chips.length - 1].getBoundingClientRect().right + 1
    caret.style.left = Math.round(at) + 'px'
    caret.style.top = Math.round(s.top + 3) + 'px'
    caret.style.height = Math.max(0, Math.round(s.height - 6)) + 'px'
    caret.classList.add('on')
  }
  window.miniWindow.onDropHint((hint) => {
    if (dragTab) return
    document.body.classList.toggle('drop-target', Boolean(hint))
    showCaret(hint ? hint.slot : null)
  })
  function insideStrip(event) {
    const r = strip.getBoundingClientRect()
    return document.body.classList.contains('tabbed') && event.clientX >= r.left && event.clientX < r.right && event.clientY >= r.top - 6 && event.clientY < r.bottom + 6
  }
  // Document-level listeners for the drag's lifetime (pointer capture keeps them coming outside the
  // window; without it, a pointerup lost to another window still ends it via lostpointercapture / blur).
  function startChipDrag(id, item, event) {
    dragTab = { id, item, pointerId: event.pointerId, x: event.clientX, y: event.clientY, moved: false, frame: 0, last: null }
    try { item.setPointerCapture(event.pointerId) } catch {}
    document.addEventListener('pointermove', onChipMove, true)
    document.addEventListener('pointerup', onChipUp, true)
    document.addEventListener('pointercancel', onChipCancel, true)
    item.addEventListener('lostpointercapture', onChipLost)
    document.addEventListener('keydown', onChipKey, true)
  }
  function finishChipDrag() {
    const drag = dragTab
    dragTab = null
    document.removeEventListener('pointermove', onChipMove, true)
    document.removeEventListener('pointerup', onChipUp, true)
    document.removeEventListener('pointercancel', onChipCancel, true)
    document.removeEventListener('keydown', onChipKey, true)
    if (drag) {
      drag.item.removeEventListener('lostpointercapture', onChipLost)
      try { if (drag.item.hasPointerCapture(drag.pointerId)) drag.item.releasePointerCapture(drag.pointerId) } catch {}
      if (drag.frame) cancelAnimationFrame(drag.frame)
      drag.item.classList.remove('dragging')
    }
    document.body.classList.remove('chip-dragging')
    showCaret(null)
    if (draggedTabs) { const tabs = draggedTabs; draggedTabs = null; renderTabs(tabs) }
    return drag
  }
  function onChipMove(event) {
    if (!dragTab || event.pointerId !== dragTab.pointerId) return
    if (!dragTab.moved) {
      if (Math.abs(event.clientX - dragTab.x) + Math.abs(event.clientY - dragTab.y) < 6) return
      dragTab.moved = true
      dragTab.item.classList.add('dragging')
      document.body.classList.add('chip-dragging')
      window.miniWindow.tabDrag('start', dragTab.id, event.screenX, event.screenY)
    }
    const inside = insideStrip(event)
    showCaret(inside ? chipSlot(event.clientX) : null)
    // Outside the strip: main hints the drop target under the pointer (once a frame).
    dragTab.last = inside ? null : { x: event.screenX, y: event.screenY }
    if (!dragTab.frame) dragTab.frame = requestAnimationFrame(() => {
      if (!dragTab) return
      dragTab.frame = 0
      const at = dragTab.last ?? { x: -1e6, y: -1e6 }
      window.miniWindow.tabDrag('move', dragTab.id, at.x, at.y)
    })
  }
  function onChipUp(event) {
    if (!dragTab || event.pointerId !== dragTab.pointerId) return
    const inside = insideStrip(event)
    const slot = chipSlot(event.clientX)
    const drag = finishChipDrag()
    if (!drag.moved) return window.miniWindow.activateTab(drag.id)
    if (inside) return window.miniWindow.moveTab(drag.id, slot)
    window.miniWindow.tabOut(drag.id, event.screenX, event.screenY)
  }
  function onChipCancel() {
    const drag = finishChipDrag()
    if (drag && drag.moved) window.miniWindow.tabDrag('cancel', drag.id, 0, 0)
  }
  function onChipLost(event) {
    // A capture lost while still pressed (not the pointerup that comes after it): give up the drag.
    if (!dragTab || event.pointerId !== dragTab.pointerId) return
    setTimeout(() => { if (dragTab && dragTab.pointerId === event.pointerId && !(event.buttons & 1)) onChipCancel() }, 0)
  }
  function onChipKey(event) {
    if (event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    onChipCancel()
  }
  // Main caught Esc (the header rarely has the keyboard): the drag is over, the release does nothing.
  window.miniWindow.onTabDragCancel(() => { if (dragTab) finishChipDrag() })
  window.addEventListener('blur', () => { if (dragTab && !dragTab.moved) finishChipDrag() })
  let deferredTabs = null
  // The chips, by tab id. A tab update touches only what changed on its chip (label, tooltip, icon,
  // active, speaker): rebuilding the strip re-created every chip and re-set every favicon's src, and a
  // page that updates often (a chat app streaming a reply) made the whole strip blink.
  const chips = new Map()
  function setIcon(chip, url) {
    if (chip.icon === url) return
    chip.icon = url
    if (!url) { if (chip.img) chip.img.hidden = true; return }
    if (!chip.img) {
      chip.img = document.createElement('img')
      chip.img.alt = ''
      chip.img.hidden = true
      chip.img.addEventListener('error', () => { chip.img.hidden = true })
      chip.item.prepend(chip.img)
    }
    // Swapped in once decoded, so the chip never shows a blank icon in between.
    const img = chip.img
    const next = new Image()
    next.src = url
    next.decode().then(() => { if (chip.icon === url) { img.src = url; img.hidden = false } }, () => { if (chip.icon === url) img.hidden = true })
  }
  function makeChip(tabId) {
    const item = document.createElement('div')
    item.className = 'tab'
    item.dataset.tabId = tabId
    item.setAttribute('role', 'tab')
    item.tabIndex = 0
    const label = document.createElement('span')
    label.className = 'label'
    const close = document.createElement('button')
    close.innerHTML = '&#215;'
    close.title = 'Close Tab'
    close.addEventListener('pointerdown', (event) => event.stopPropagation())
    close.addEventListener('click', (event) => { event.stopPropagation(); window.miniWindow.closeTab(tabId) })
    const volume = makeVolume(document.createElement('span'), true)
    item.append(label, volume.root, close)
    item.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); window.miniWindow.activateTab(tabId) }
      // ⌥⇧← / ⌥⇧→ (like the sidebar's ⌥⇧↑ / ⌥⇧↓): move the chip along the strip.
      else if (event.altKey && event.shiftKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) { event.preventDefault(); window.miniWindow.stepTab(tabId, event.key === 'ArrowLeft' ? -1 : 1) }
    })
    // Click: switch. Press and drag: along the strip reorders; out of the window splits off, onto
    // another mini window joins it, onto a browser window goes back to its sidebar. Esc cancels.
    item.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || dragTab) return
      startChipDrag(tabId, item, event)
    })
    return { item, label, close, volume, img: null, icon: null }
  }
  function renderTabs(tabs) {
    document.body.classList.toggle('tabbed', tabs.length > 1)
    syncPopoutTitles()
    // With a strip, the header's close button closes the tab on screen (the rest stay).
    const closeButton = document.getElementById('close')
    setHint(closeButton, tabs.length > 1 ? 'Close Tab' : 'Close')
    setAttr(closeButton, 'aria-label', tabs.length > 1 ? 'Close Tab' : 'Close Mini Window')
    // Mid-drag the strip stays as it is; the latest tabs render when it is let go.
    if (dragTab) { draggedTabs = tabs; return }
    const ids = tabs.map((tab) => tab.tabId)
    const current = [...strip.querySelectorAll('.tab')]
    const same = ids.length === current.length && ids.every((id, index) => current[index].dataset.tabId === id)
    // Never take a chip away or move it under a slider being dragged.
    if (!same && volumeBusy > 0) { deferredTabs = tabs; return }
    for (const tab of tabs) {
      let chip = chips.get(tab.tabId)
      if (!chip) { chip = makeChip(tab.tabId); chips.set(tab.tabId, chip) }
      chip.item.classList.toggle('active', Boolean(tab.active))
      setAttr(chip.item, 'aria-selected', tab.active ? 'true' : 'false')
      setAttr(chip.item, 'title', tab.title + ' (drag out of the window to split it off)')
      setText(chip.label, tab.title)
      setAttr(chip.close, 'aria-label', 'Close ' + tab.title)
      setIcon(chip, tab.faviconUrl || null)
      chip.volume.update(tab)
    }
    if (same) return
    const keep = new Set(ids)
    for (const id of [...chips.keys()]) if (!keep.has(id)) chips.delete(id)
    strip.replaceChildren(...ids.map((id) => chips.get(id).item), stripPlus)
    requestAnimationFrame(reportStripLayout)
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
  document.getElementById('plus').addEventListener('click', () => window.miniWindow.newTab())
  // The address field: main owns what it shows (text, rows, which row is filled in); this page sends
  // what is typed and the keys, and draws main's answer. A typed reply never rewrites the input (the
  // user may have typed on since); only a key's reply (a filled-in row, Esc putting text back) does.
  const addrForm = document.getElementById('addr')
  const addrInput = document.getElementById('addrInput')
  const drop = document.getElementById('drop')
  let address = { open: false, view: null }
  let addressFocusSeen = 0
  let dropKey = ''
  function appendParts(parent, parts, url) {
    for (const part of parts) {
      const span = document.createElement('span')
      span.textContent = part.text
      if (url && part.role === 'host') span.className = 'host'
      if (part.match) span.classList.add('m')
      parent.append(span)
    }
  }
  function placeDrop() {
    // Under everything the header shows (the row, and the strip unless it sits in the row).
    const underStrip = document.body.classList.contains('tabbed') && !document.body.classList.contains('popout')
    const bottom = Math.max(bar.getBoundingClientRect().bottom, underStrip ? strip.getBoundingClientRect().bottom : 0)
    drop.style.top = Math.round(bottom + 2) + 'px'
  }
  function renderDrop(view, height) {
    const rows = view ? view.rows : []
    const shown = height > 0 && Boolean(view) && (rows.length > 0 || Boolean(view.keyword)) && document.activeElement === addrInput
    drop.classList.toggle('on', shown)
    setAttr(addrInput, 'aria-expanded', shown ? 'true' : 'false')
    if (!shown) return
    placeDrop()
    drop.style.height = height + 'px'
    const key = JSON.stringify([view.rows, view.keyword, view.selected])
    if (key === dropKey) return
    dropKey = key
    const items = []
    if (view.keyword) {
      const row = document.createElement('div')
      row.className = 'row' + (view.selected < 0 ? ' sel' : '')
      row.setAttribute('role', 'option')
      const main = document.createElement('div')
      main.className = 'main'
      const title = document.createElement('div')
      title.className = 't'
      title.textContent = view.keyword.label
      const hintLine = document.createElement('div')
      hintLine.className = 'u'
      hintLine.textContent = 'Press Enter'
      main.append(title, hintLine)
      const chip = document.createElement('span')
      chip.className = 'chip'
      chip.textContent = view.keyword.chip
      row.append(main, chip)
      row.addEventListener('mousedown', (event) => event.preventDefault())
      row.addEventListener('click', () => window.miniWindow.addressSubmit(addrInput.value))
      items.push(row)
    }
    view.rows.forEach((suggestion, index) => {
      const row = document.createElement('div')
      row.className = 'row' + (index === view.selected ? ' sel' : '')
      row.setAttribute('role', 'option')
      row.setAttribute('aria-selected', index === view.selected ? 'true' : 'false')
      row.dataset.url = suggestion.url
      const main = document.createElement('div')
      main.className = 'main'
      const title = document.createElement('div')
      title.className = 't'
      appendParts(title, suggestion.title, false)
      const url = document.createElement('div')
      url.className = 'u'
      appendParts(url, suggestion.urlParts, true)
      main.append(title, url)
      const source = document.createElement('span')
      source.className = 'src'
      source.textContent = suggestion.source
      row.append(main, source)
      // Never takes the focus from the field (it would close the dropdown before the click lands).
      row.addEventListener('mousedown', (event) => event.preventDefault())
      row.addEventListener('click', () => window.miniWindow.addressPick(index))
      items.push(row)
    })
    drop.replaceChildren(...items)
  }
  window.miniWindow.onAddress((state) => {
    address = state || { open: false, view: null }
    document.body.classList.toggle('addressing', Boolean(address.open))
    if (!address.open) {
      drop.classList.remove('on')
      dropKey = ''
      if (document.activeElement === addrInput) addrInput.blur()
      return
    }
    const view = address.view
    if (view && address.setText && addrInput.value !== view.text) addrInput.value = view.text
    if (address.focus && address.focus !== addressFocusSeen) {
      addressFocusSeen = address.focus
      addrInput.focus()
      if (address.select) addrInput.select()
    }
    if (view && address.setText && view.caretToEnd) { const end = addrInput.value.length; addrInput.setSelectionRange(end, end) }
    renderDrop(view, address.height || 0)
  })
  addrForm.addEventListener('submit', (event) => { event.preventDefault(); window.miniWindow.addressSubmit(addrInput.value) })
  addrInput.addEventListener('input', () => window.miniWindow.addressInput(addrInput.value))
  // Pressed (the floating header's panel never takes the keyboard by itself): main lets it have it first.
  addrInput.addEventListener('pointerdown', (event) => { event.stopPropagation(); if (document.activeElement !== addrInput) window.miniWindow.addressFocus() })
  addrInput.addEventListener('focus', () => renderDrop(address.view, address.height || 0))
  addrInput.addEventListener('blur', () => { drop.classList.remove('on'); if (address.open) window.miniWindow.addressBlur() })
  addrInput.addEventListener('keydown', (event) => {
    if (event.isComposing) return
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); window.miniWindow.addressKey('escape'); return }
    if (event.altKey || event.ctrlKey || event.metaKey) return
    const rows = address.view ? address.view.rows.length : 0
    const direction = event.key === 'ArrowDown' || (event.key === 'Tab' && !event.shiftKey) ? 'down' : event.key === 'ArrowUp' || (event.key === 'Tab' && event.shiftKey) ? 'up' : null
    if (!direction || (event.key !== 'Tab' && event.shiftKey) || rows === 0) return
    event.preventDefault()
    window.miniWindow.addressKey(direction)
  })
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
  // SURFFISH_DEBUG_HEADER (main/mini-header-debug.ts): while main has it on, every DOM write, class
  // toggle, focus / visibility / hover change and theme flip here goes to the debug log, batched.
  let debugTrace = null
  function debugNode(node) {
    if (!node) return '?'
    if (node.nodeType !== 1) return debugNode(node.parentNode) + '>' + node.nodeName
    if (node.id) return '#' + node.id
    if (node.classList && node.classList.contains('tab')) return '.tab[' + (node.dataset.tabId || '') + ']'
    const cls = typeof node.className === 'string' ? node.className.trim().split(' ').filter(Boolean).join('.') : ''
    return node.tagName.toLowerCase() + (cls ? '.' + cls : '')
  }
  function debugClip(value) { const text = String(value == null ? '' : value); return text.length > 80 ? text.slice(0, 77) + '...' : text }
  function startDebugTrace() {
    if (debugTrace) return
    const queue = []
    let timer = 0
    const push = (line) => {
      queue.push(Math.round(performance.now()) + 'ms ' + line)
      if (!timer) timer = setTimeout(() => { timer = 0; window.miniWindow.debugLog(queue.splice(0, queue.length)) }, 200)
    }
    const observer = new MutationObserver((records) => {
      for (const r of records) {
        if (r.type === 'attributes') {
          const now = r.target.getAttribute(r.attributeName)
          push((r.attributeName === 'class' ? 'class ' : 'attr ') + debugNode(r.target) + (r.attributeName === 'class' ? '' : ' ' + r.attributeName) + ': ' + JSON.stringify(debugClip(r.oldValue)) + ' -> ' + JSON.stringify(debugClip(now)))
        } else if (r.type === 'characterData') {
          push('text ' + debugNode(r.target) + ': ' + JSON.stringify(debugClip(r.oldValue)) + ' -> ' + JSON.stringify(debugClip(r.target.data)))
        } else {
          push('children ' + debugNode(r.target) + ': +' + r.addedNodes.length + ' -' + r.removedNodes.length + (r.target.id === 'title' || r.target.id === 'url' || r.target.id === 'hint' ? ' ' + JSON.stringify(debugClip(r.target.textContent)) : ''))
        }
      }
    })
    observer.observe(document.documentElement, { subtree: true, attributes: true, attributeOldValue: true, childList: true, characterData: true, characterDataOldValue: true })
    const abort = new AbortController()
    const on = (target, type, line) => target.addEventListener(type, () => push(typeof line === 'function' ? line() : line), { signal: abort.signal, capture: true })
    on(window, 'focus', 'window focus')
    on(window, 'blur', 'window blur')
    on(document, 'visibilitychange', () => 'visibility ' + document.visibilityState)
    on(bar, 'mouseenter', 'hover enter (strip)')
    on(bar, 'mouseleave', 'hover leave (strip)')
    on(icon, 'load', () => 'icon loaded ' + debugClip(icon.currentSrc))
    on(icon, 'error', 'icon failed')
    on(window, 'resize', () => 'resize ' + innerWidth + 'x' + innerHeight)
    const queries = ['(prefers-color-scheme: dark)', '(prefers-reduced-transparency: reduce)', '(prefers-contrast: more)']
    for (const query of queries) { const list = matchMedia(query); list.addEventListener('change', () => push('media ' + query + ' = ' + list.matches), { signal: abort.signal }) }
    push('trace on: body.' + document.body.className.trim().split(' ').filter(Boolean).join('.') + ' title=' + JSON.stringify(debugClip(document.getElementById('title').textContent)) + ' dark=' + matchMedia('(prefers-color-scheme: dark)').matches + ' visibility=' + document.visibilityState + ' focused=' + document.hasFocus())
    debugTrace = { observer, abort }
  }
  function stopDebugTrace() {
    if (!debugTrace) return
    debugTrace.observer.disconnect()
    debugTrace.abort.abort()
    debugTrace = null
  }
  if (window.miniWindow.onDebug) window.miniWindow.onDebug((on) => { if (on) startDebugTrace(); else stopDebugTrace() })
</script>
</body></html>`
